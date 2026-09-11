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
  if (!file) return { rows: [], error: "Koi file nahi mili." };

  try {
    const buffer = await file.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return { rows: [], error: "Sheet khali hai." };

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
    return { rows: [], error: "Excel file parse nahi ho saki. Format check karen." };
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
    return { error: batchErr?.message ?? "Batch nahi ban saka.", importedCount: 0, rowErrors: [] };
  }

  const rowErrors: { row: number; message: string }[] = [];
  let importedCount = 0;
  const defaultType = entityType === "clients" ? "client" : "supplier";

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.legal_name?.trim()) {
      rowErrors.push({ row: i + 1, message: "Naam khali hai — row skip hui." });
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
    return { error: batchErr?.message ?? "Batch nahi ban saka.", importedCount: 0, rowErrors: [] };
  }

  const rowErrors: { row: number; message: string }[] = [];
  let importedCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.item_code?.trim() || !r.warehouse_code?.trim() || !r.qty || !r.as_of_date) {
      rowErrors.push({ row: i + 1, message: "Item code, warehouse code, qty aur date zaroori hain — row skip hui." });
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
    return { error: batchErr?.message ?? "Batch nahi ban saka.", importedCount: 0, rowErrors: [] };
  }

  const isReceivable = entityType === "opening_receivables";
  const partyType = isReceivable ? "client" : "supplier";
  const rowErrors: { row: number; message: string }[] = [];
  let importedCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.party_name?.trim() || !r.amount || !r.as_of_date) {
      rowErrors.push({ row: i + 1, message: "Naam, amount aur date zaroori hain — row skip hui." });
      continue;
    }

    // find or create the party
    let partyId: string | null = null;
    const { data: existing } = await supabase
      .from("parties")
      .select("id")
      .ilike("legal_name", r.party_name.trim())
      .limit(1)
      .maybeSingle();

    if (existing) {
      partyId = existing.id;
    } else {
      const { data: created, error: createErr } = await supabase
        .from("parties")
        .insert({ legal_name: r.party_name.trim(), party_type: partyType, created_by: user?.id })
        .select("id")
        .single();
      if (createErr || !created) {
        rowErrors.push({ row: i + 1, message: createErr?.message ?? "Party nahi ban saki." });
        continue;
      }
      partyId = created.id;
    }

    const lines = isReceivable
      ? [
          { account_code: "1200", party_id: partyId, debit: r.amount, credit: 0, memo: "Opening balance" },
          { account_code: "1900", party_id: null, debit: 0, credit: r.amount, memo: "Opening balance" },
        ]
      : [
          { account_code: "1900", party_id: null, debit: r.amount, credit: 0, memo: "Opening balance" },
          { account_code: "2100", party_id: partyId, debit: 0, credit: r.amount, memo: "Opening balance" },
        ];

    const { error: jeError } = await supabase.rpc("fn_post_journal_entry", {
      p_entry_date: r.as_of_date,
      p_narration: r.narration || `Opening balance — ${r.party_name.trim()}`,
      p_source_table: "import_batches",
      p_source_id: batch.id,
      p_lines: lines,
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
