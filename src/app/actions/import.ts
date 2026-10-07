"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import ExcelJS from "exceljs";

/**
 * Parses an uploaded .xlsx file into rows keyed by header. Runs server-side
 * (Server Action) so the ~1MB exceljs library never ships to the browser
 * bundle, and so untrusted file parsing never runs on the client.
 */
export async function parseExcelFileAction(formData: FormData): Promise<{
  rows: Record<string, string>[];
  error: string | null;
}> {
  const file = formData.get("file") as File | null;
  if (!file) return { rows: [], error: "No file found." };

  try {
    const buffer = await file.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return { rows: [], error: "Sheet is empty." };

    const headerRow = sheet.getRow(1).values as (string | undefined)[];
    const headers = headerRow.slice(1).map((h) => String(h ?? "").trim());
    const rows: Record<string, string>[] = [];

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const values = row.values as (string | number | undefined)[];
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        obj[h] = String(values[i + 1] ?? "").trim();
      });
      if (Object.values(obj).some((v) => v)) rows.push(obj);
    });

    return { rows, error: null };
  } catch {
    return { rows: [], error: "Failed to parse the Excel file. Please check the format." };
  }
}

type ClientSupplierRow = {
  legal_name: string;
  party_type: "client" | "supplier" | "both";
  ntn?: string;
  strn?: string;
  cnic?: string;
  billing_address?: string;
  province?: string;
  credit_limit?: number;
  credit_days?: number;
};

type OpeningBalanceRow = {
  party_name: string;
  amount: number;
  as_of_date: string; // yyyy-mm-dd
  narration?: string;
};

export type ImportResult = {
  error: string | null;
  importedCount: number;
  rowErrors: { row: number; message: string }[];
};

export async function commitPartiesImportAction(
  entityType: "clients" | "suppliers",
  rows: ClientSupplierRow[]
): Promise<ImportResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: batch, error: batchErr } = await supabase
    .from("import_batches")
    .insert({ entity_type: entityType, uploaded_by: user?.id, row_count: rows.length })
    .select("id")
    .single();

  if (batchErr || !batch) {
    return { error: batchErr?.message ?? "Failed to create batch.", importedCount: 0, rowErrors: [] };
  }

  const rowErrors: { row: number; message: string }[] = [];
  let importedCount = 0;
  const defaultType = entityType === "clients" ? "client" : "supplier";

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.legal_name?.trim()) {
      rowErrors.push({ row: i + 1, message: "Name is empty — row skipped." });
      continue;
    }
    const { error } = await supabase.from("parties").insert({
      legal_name: r.legal_name.trim(),
      party_type: r.party_type || defaultType,
      ntn: r.ntn || null,
      strn: r.strn || null,
      cnic: r.cnic || null,
      billing_address: r.billing_address || null,
      province: r.province || null,
      credit_limit: r.credit_limit ?? 0,
      credit_days: r.credit_days ?? 0,
      created_by: user?.id,
    });
    if (error) {
      rowErrors.push({ row: i + 1, message: error.message });
    } else {
      importedCount++;
    }
  }

  await supabase
    .from("import_batches")
    .update({
      status: rowErrors.length === rows.length ? "failed" : "committed",
      row_count: importedCount,
      error_report: rowErrors.length ? rowErrors : null,
      committed_at: new Date().toISOString(),
    })
    .eq("id", batch.id);

  revalidatePath("/setup/import");
  return { error: null, importedCount, rowErrors };
}

type OpeningStockRow = {
  item_code: string;
  warehouse_code: string;
  qty: number;
  rate: number;
  as_of_date: string; // yyyy-mm-dd
  notes?: string;
};

const LOOKUP_CHUNK = 200;

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Returns "item_code|warehouse_code" for every pair in `rows` that already
 * has an 'OpeningStock' stock_ledger entry (the txn_type
 * fn_import_opening_stock posts via _fn_post_stock_ledger).
 */
async function findExistingOpeningStock(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: OpeningStockRow[]
): Promise<{ keys: Set<string>; error: string | null }> {
  const keys = new Set<string>();
  const itemCodes = [...new Set(rows.map((r) => r.item_code?.trim()).filter((c): c is string => !!c))];
  const warehouseCodes = [...new Set(rows.map((r) => r.warehouse_code?.trim()).filter((c): c is string => !!c))];
  if (!itemCodes.length || !warehouseCodes.length) return { keys, error: null };

  const itemCodeById = new Map<string, string>();
  for (const part of chunk(itemCodes, LOOKUP_CHUNK)) {
    const { data, error } = await supabase.from("items").select("id, item_code").in("item_code", part);
    if (error) return { keys, error: error.message };
    for (const it of data ?? []) itemCodeById.set(it.id, it.item_code);
  }
  const { data: warehouses, error: whError } = await supabase.from("warehouses").select("id, code").in("code", warehouseCodes);
  if (whError) return { keys, error: whError.message };
  const warehouseCodeById = new Map((warehouses ?? []).map((w) => [w.id, w.code] as const));
  if (!itemCodeById.size || !warehouseCodeById.size) return { keys, error: null };

  for (const part of chunk([...itemCodeById.keys()], LOOKUP_CHUNK)) {
    const { data, error } = await supabase
      .from("stock_ledger")
      .select("item_id, warehouse_id")
      .eq("txn_type", "OpeningStock")
      .in("item_id", part)
      .in("warehouse_id", [...warehouseCodeById.keys()]);
    if (error) return { keys, error: error.message };
    for (const l of data ?? []) {
      const itemCode = itemCodeById.get(l.item_id);
      const whCode = warehouseCodeById.get(l.warehouse_id);
      if (itemCode && whCode) keys.add(`${itemCode}|${whCode}`);
    }
  }
  return { keys, error: null };
}

export async function commitOpeningStockImportAction(rows: OpeningStockRow[]): Promise<ImportResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: batch, error: batchErr } = await supabase
    .from("import_batches")
    .insert({ entity_type: "opening_stock", uploaded_by: user?.id, row_count: rows.length })
    .select("id")
    .single();

  if (batchErr || !batch) {
    return { error: batchErr?.message ?? "Failed to create batch.", importedCount: 0, rowErrors: [] };
  }

  const rowErrors: { row: number; message: string }[] = [];
  let importedCount = 0;

  // Idempotency: fn_import_opening_stock posts a fresh 'OpeningStock' ledger
  // row every time it runs, so re-uploading the same file used to double the
  // stock (and the opening journal). Any item+warehouse that already has an
  // opening entry — or appears twice in this file — is skipped and reported.
  const existing = await findExistingOpeningStock(supabase, rows);
  if (existing.error) {
    await supabase.from("import_batches").update({ status: "failed", row_count: 0 }).eq("id", batch.id);
    return { error: existing.error, importedCount: 0, rowErrors: [] };
  }
  const seen = existing.keys;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.item_code?.trim() || !r.warehouse_code?.trim() || !r.qty || !r.as_of_date) {
      rowErrors.push({ row: i + 1, message: "Item code, warehouse code, qty, and date are required — row skipped." });
      continue;
    }

    const key = `${r.item_code.trim()}|${r.warehouse_code.trim()}`;
    if (seen.has(key)) {
      rowErrors.push({
        row: i + 1,
        message: `Opening stock for item "${r.item_code.trim()}" in warehouse "${r.warehouse_code.trim()}" was already imported — row skipped.`,
      });
      continue;
    }

    const { error } = await supabase.rpc("fn_import_opening_stock", {
      p_item_code: r.item_code.trim(),
      p_warehouse_code: r.warehouse_code.trim(),
      p_qty: r.qty,
      p_rate: r.rate ?? 0,
      p_as_of_date: r.as_of_date,
      p_ref_table: "import_batches",
      p_ref_id: batch.id,
      p_notes: r.notes as string,
    });

    if (error) {
      rowErrors.push({ row: i + 1, message: error.message });
    } else {
      importedCount++;
      seen.add(key);
    }
  }

  await supabase
    .from("import_batches")
    .update({
      status: rowErrors.length === rows.length ? "failed" : "committed",
      row_count: importedCount,
      error_report: rowErrors.length ? rowErrors : null,
      committed_at: new Date().toISOString(),
    })
    .eq("id", batch.id);

  revalidatePath("/setup/import");
  revalidatePath("/inventory");
  return { error: null, importedCount, rowErrors };
}

export async function commitOpeningBalancesImportAction(
  entityType: "opening_receivables" | "opening_payables",
  rows: OpeningBalanceRow[]
): Promise<ImportResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: batch, error: batchErr } = await supabase
    .from("import_batches")
    .insert({ entity_type: entityType, uploaded_by: user?.id, row_count: rows.length })
    .select("id")
    .single();

  if (batchErr || !batch) {
    return { error: batchErr?.message ?? "Failed to create batch.", importedCount: 0, rowErrors: [] };
  }

  const isReceivable = entityType === "opening_receivables";
  const rowErrors: { row: number; message: string }[] = [];
  let importedCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.party_name?.trim() || !r.amount || !r.as_of_date) {
      rowErrors.push({ row: i + 1, message: "Name, amount, and date are required — row skipped." });
      continue;
    }

    // One database call per row: exact name match (no ILIKE wildcards),
    // party-type check, creates the party if allowed, refuses a second
    // opening balance for the same party, and links the entry to this
    // batch (phase 47.05).
    const { error: jeError } = await supabase.rpc("fn_import_opening_balance", {
      p_kind: isReceivable ? "receivable" : "payable",
      p_party_name: r.party_name.trim(),
      p_amount: r.amount,
      p_as_of_date: r.as_of_date,
      p_narration: r.narration as string,
      p_batch_id: batch.id,
    });

    if (jeError) {
      rowErrors.push({ row: i + 1, message: jeError.message });
    } else {
      importedCount++;
    }
  }

  await supabase
    .from("import_batches")
    .update({
      status: rowErrors.length === rows.length ? "failed" : "committed",
      row_count: importedCount,
      error_report: rowErrors.length ? rowErrors : null,
      committed_at: new Date().toISOString(),
    })
    .eq("id", batch.id);

  revalidatePath("/setup/import");
  return { error: null, importedCount, rowErrors };
}
