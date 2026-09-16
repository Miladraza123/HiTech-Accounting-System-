// HiTech Accounting System — Daily Backup runner.
//
// Standalone Node script (deliberately outside the Next.js app bundle —
// it runs headless via GitHub Actions, never in the browser). Every
// night it:
//   1. Signs in as the dedicated, low-privilege "Backup Bot" account
//      (never a service-role/admin key — see README "Daily Backup"
//      section for how that account is provisioned and what it can
//      read).
//   2. Fetches every table (see TABLE_ORDER — dependency order, parents
//      before children; this is also the order the in-app Restore
//      feature replays them in).
//   3. Builds an Excel workbook (for a human to read) and a JSON file
//      (for the in-app Restore feature to replay).
//   4. Emails both as attachments via Gmail SMTP.
//
// A single table failing to fetch must never abort the whole backup —
// see fetchAll(). Only a total failure (bad login, no connectivity)
// throws.
"use strict";

const { createClient } = require("@supabase/supabase-js");
const ExcelJS = require("exceljs");
const nodemailer = require("nodemailer");

// ---------- Config ----------
const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_ANON_KEY = requireEnv("SUPABASE_ANON_KEY");
const BACKUP_EMAIL = requireEnv("BACKUP_EMAIL");
const BACKUP_PASSWORD = requireEnv("BACKUP_PASSWORD");
const GMAIL_USER = requireEnv("GMAIL_USER");
const GMAIL_APP_PASSWORD = requireEnv("GMAIL_APP_PASSWORD");
const BACKUP_TO_EMAIL = requireEnv("BACKUP_TO_EMAIL");

const APP_NAME = "HiTech";
const BUSINESS_TIMEZONE = "Asia/Karachi";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

// ---------- Table list, in dependency order (parents before children) ----------
// Same order the in-app Restore feature (src/app/actions/backupRestore.ts)
// replays on insert, and the reverse order it deletes in during a
// "replace" restore. Kept in sync manually — this script intentionally
// lives outside the Next.js app bundle (see file header), so the two
// can't literally share one source file.
const TABLE_ORDER = [
  "activity_timeline", "attachments", "audit_log", "bank_accounts", "chart_of_accounts",
  "daily_snapshots", "import_batches", "journal_entries", "login_sessions", "numbering_sequences",
  "profiles", "provinces", "query_sources", "role_permissions", "roles", "units", "warehouses",
  "company", "expense_heads", "items", "parties", "petty_cash_funds", "stock_transfers", "tasks",
  "unit_conversions", "user_roles", "vehicles", "contra_transfers", "item_alt_units", "journal_lines",
  "party_contacts", "payments", "product_templates", "queries", "stock_adjustments", "stock_ledger",
  "stock_transfer_lines", "product_template_lines", "quotations", "quotation_revisions", "sales_orders",
  "delivery_challans", "invoices", "purchase_orders", "quotation_lines", "sales_order_lines",
  "sales_order_revisions", "delivery_challan_lines", "grns", "invoice_lines", "jobs",
  "purchase_order_lines", "sales_returns", "expenses", "grn_lines", "job_cost_ledger",
  "job_material_requirements", "sales_return_lines", "stock_reservations", "supplier_bills",
  "payment_allocations", "purchase_returns", "supplier_bill_lines", "purchase_return_lines",
];

// ---------- Timezone helpers ----------
// GitHub Actions runners are UTC; the business operates in Karachi (PKT,
// UTC+5, no DST) — so both "which calendar date is this backup for" and
// "what time did it actually run, in words a Karachi reader trusts" need
// explicit conversion rather than naive `new Date()` output.
function karachiParts(d = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return parts; // { year, month, day, hour, minute, second }
}

/** The calendar date (Karachi) this backup covers — the job runs after midnight Karachi, covering the day that just ended. */
function dataDate() {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const p = karachiParts(yesterday);
  return `${p.year}-${p.month}-${p.day}`;
}

function takenAtText() {
  const p = karachiParts();
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} PKT (Asia/Karachi)`;
}

// ---------- Resilient fetch ----------
async function fetchAll(supabase) {
  const tables = {};
  const missed = [];
  for (const table of TABLE_ORDER) {
    try {
      const { data, error } = await supabase.from(table).select("*");
      if (error) throw error;
      tables[table] = data ?? [];
    } catch (err) {
      console.error(`[backup] table "${table}" failed:`, err.message ?? err);
      tables[table] = [];
      missed.push({ table, reason: String(err.message ?? err) });
    }
  }
  const totalRows = Object.values(tables).reduce((s, rows) => s + rows.length, 0);
  if (missed.length === TABLE_ORDER.length || (totalRows === 0 && missed.length > 0)) {
    throw new Error(
      `Backup aborted — every table failed to fetch (likely a login/connectivity problem, not a per-table issue). First error: ${missed[0]?.reason}`
    );
  }
  return { tables, missed };
}

// ---------- Excel (human-readable) ----------
function autoWidth(ws) {
  ws.columns.forEach((col) => {
    let max = 10;
    col.eachCell?.({ includeEmpty: true }, (cell) => {
      const len = cell.value == null ? 0 : String(cell.value).length;
      if (len > max) max = len;
    });
    col.width = Math.min(max + 2, 45);
  });
}

function addSheet(wb, name, headers, rows) {
  const ws = wb.addWorksheet(name.slice(0, 31)); // Excel sheet-name length limit
  ws.addRow(headers.map((h) => h.label));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E2D4" } };
  for (const row of rows) {
    ws.addRow(headers.map((h) => (typeof h.value === "function" ? h.value(row) : row[h.value])));
  }
  headers.forEach((h, i) => {
    if (h.numFmt) ws.getColumn(i + 1).numFmt = h.numFmt;
  });
  autoWidth(ws);
  return ws;
}

function indexBy(rows, key) {
  return new Map((rows ?? []).map((r) => [r[key], r]));
}

// ---------- Line-item detail + complete raw dump ----------
// The summary sheets above are header-level only: an invoice showed its
// number, client and total, but not WHICH items at WHAT rate. That detail
// was always in the JSON restore file, but nobody opens a 64-table JSON to
// answer "what was on invoice INV-0003". These two additions put every
// column and every row into the workbook people actually open.

/**
 * Excel caps sheet names at 31 chars and treats them as case-INSENSITIVE
 * for uniqueness -- ExcelJS throws on a collision. That bites here because
 * the summary sheets use title case ("Items", "Invoices") and the raw dump
 * uses the table names ("items", "invoices"), which collide.
 */
function uniqueSheetName(used, desired) {
  let name = desired.slice(0, 31);
  let n = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${n++})`;
    name = `${desired.slice(0, 31 - suffix.length)}${suffix}`;
  }
  used.add(name.toLowerCase());
  return name;
}

/** Excel cannot hold a jsonb object or an array in a cell. */
function cellValue(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

/**
 * Every row of a table with every column, exactly as stored. Columns are
 * taken from the union of all rows' keys, so a column that is null in the
 * first row is never dropped.
 */
function addRawSheet(wb, used, table, rows) {
  const list = rows ?? [];
  const cols = [];
  const seen = new Set();
  for (const row of list) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) { seen.add(k); cols.push(k); }
    }
  }
  const name = uniqueSheetName(used, `DATA ${table}`);
  const ws = wb.addWorksheet(name);
  if (!cols.length) {
    ws.addRow(["(no rows)"]);
    return { name, rows: 0, cols: 0 };
  }
  ws.addRow(cols);
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEAE0" } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const row of list) ws.addRow(cols.map((c) => cellValue(row[c])));
  autoWidth(ws);
  return { name, rows: list.length, cols: cols.length };
}

function buildExcel(tables) {
  const wb = new ExcelJS.Workbook();
  wb.creator = `${APP_NAME} Daily Backup`;
  wb.created = new Date();

  // Created first, filled last. ExcelJS derives `wb.worksheets` from its
  // internal map, so a sheet cannot be moved to the front after the fact --
  // it has to be added before everything else.
  const contents = wb.addWorksheet("Contents");

  const partyById = indexBy(tables.parties, "id");
  const itemById = indexBy(tables.items, "id");
  const whById = indexBy(tables.warehouses, "id");
  const coaById = indexBy(tables.chart_of_accounts, "id");

  // --- Trial Balance (derived from journal_lines, mirrors the app's own trial_balance view logic) ---
  const balances = new Map();
  for (const jl of tables.journal_lines ?? []) {
    const acc = coaById.get(jl.account_id);
    const key = jl.account_id;
    const rec = balances.get(key) ?? { code: acc?.code ?? "—", name: acc?.name ?? "—", type: acc?.account_type ?? "—", debit: 0, credit: 0 };
    rec.debit += Number(jl.debit ?? 0);
    rec.credit += Number(jl.credit ?? 0);
    balances.set(key, rec);
  }
  addSheet(
    wb, "Trial Balance",
    [
      { label: "Code", value: "code" }, { label: "Account", value: "name" }, { label: "Type", value: "type" },
      { label: "Total Debit", value: "debit", numFmt: "#,##0.00" }, { label: "Total Credit", value: "credit", numFmt: "#,##0.00" },
      { label: "Balance", value: (r) => r.debit - r.credit, numFmt: "#,##0.00" },
    ],
    Array.from(balances.values()).sort((a, b) => a.code.localeCompare(b.code))
  );

  // --- Journal (flattened entries + lines) ---
  const entryById = indexBy(tables.journal_entries, "id");
  addSheet(
    wb, "Journal",
    [
      { label: "Entry Date", value: (r) => entryById.get(r.journal_entry_id)?.entry_date },
      { label: "Entry #", value: (r) => entryById.get(r.journal_entry_id)?.entry_no },
      { label: "Narration", value: (r) => entryById.get(r.journal_entry_id)?.narration },
      { label: "Account", value: (r) => coaById.get(r.account_id)?.name ?? "—" },
      { label: "Party", value: (r) => (r.party_id ? partyById.get(r.party_id)?.legal_name : "") },
      { label: "Debit", value: "debit", numFmt: "#,##0.00" }, { label: "Credit", value: "credit", numFmt: "#,##0.00" },
      { label: "Memo", value: "memo" },
    ],
    (tables.journal_lines ?? []).sort((a, b) =>
      (entryById.get(a.journal_entry_id)?.entry_date ?? "").localeCompare(entryById.get(b.journal_entry_id)?.entry_date ?? "")
    )
  );

  // --- AR / AP Aging (mirrors src/lib/aging.ts bucket logic) ---
  function agingBucket(dueDate) {
    const days = Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000);
    if (days <= 0) return "current";
    if (days <= 30) return "d1_30";
    if (days <= 60) return "d31_60";
    if (days <= 90) return "d61_90";
    return "d90_plus";
  }
  function dueDateFrom(docDate, creditDays) {
    const d = new Date(docDate);
    d.setDate(d.getDate() + (creditDays ?? 0));
    return d.toISOString().slice(0, 10);
  }
  function buildAging(docs, docDateKey, partyKey, amountOf) {
    const rows = new Map();
    for (const doc of docs ?? []) {
      const party = partyById.get(doc[partyKey]);
      if (!party) continue;
      const amount = amountOf(doc);
      if (!amount) continue;
      const bucket = agingBucket(dueDateFrom(doc[docDateKey], party.credit_days ?? 0));
      const rec = rows.get(party.id) ?? { name: party.legal_name, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
      rec[bucket] += amount;
      rows.set(party.id, rec);
    }
    return Array.from(rows.values()).map((r) => ({ ...r, total: r.current + r.d1_30 + r.d31_60 + r.d61_90 + r.d90_plus }));
  }
  const paidByInvoice = new Map();
  for (const alloc of tables.payment_allocations ?? []) {
    if (!alloc.invoice_id) continue;
    paidByInvoice.set(alloc.invoice_id, (paidByInvoice.get(alloc.invoice_id) ?? 0) + Number(alloc.amount ?? 0));
  }
  const arRows = buildAging(
    (tables.invoices ?? []).filter((i) => i.status !== "Cancelled"),
    "invoice_date", "party_id",
    (i) => Number(i.grand_total ?? 0) - (paidByInvoice.get(i.id) ?? 0)
  );
  addSheet(wb, "AR Aging", agingHeaders("Client"), arRows.sort((a, b) => b.total - a.total));

  const paidByBill = new Map();
  for (const alloc of tables.payment_allocations ?? []) {
    if (!alloc.supplier_bill_id) continue;
    paidByBill.set(alloc.supplier_bill_id, (paidByBill.get(alloc.supplier_bill_id) ?? 0) + Number(alloc.amount ?? 0));
  }
  const apRows = buildAging(
    (tables.supplier_bills ?? []).filter((b) => b.status !== "Cancelled").map((b) => ({ ...b, party_id: b.supplier_id })),
    "bill_date", "party_id",
    (b) => Number(b.grand_total ?? 0) - (paidByBill.get(b.id) ?? 0)
  );
  addSheet(wb, "AP Aging", agingHeaders("Supplier"), apRows.sort((a, b) => b.total - a.total));

  function agingHeaders(label) {
    return [
      { label, value: "name" },
      { label: "Current", value: "current", numFmt: "#,##0.00" }, { label: "1-30", value: "d1_30", numFmt: "#,##0.00" },
      { label: "31-60", value: "d31_60", numFmt: "#,##0.00" }, { label: "61-90", value: "d61_90", numFmt: "#,##0.00" },
      { label: "90+", value: "d90_plus", numFmt: "#,##0.00" }, { label: "Total", value: "total", numFmt: "#,##0.00" },
    ];
  }

  // --- Parties ---
  addSheet(
    wb, "Parties",
    [
      { label: "Legal Name", value: "legal_name" }, { label: "Type", value: "party_type" },
      { label: "NTN", value: "ntn" }, { label: "STRN", value: "strn" },
      { label: "Credit Limit", value: "credit_limit", numFmt: "#,##0.00" }, { label: "Credit Days", value: "credit_days" },
      { label: "Active", value: (r) => (r.is_active ? "Yes" : "No") },
    ],
    (tables.parties ?? []).sort((a, b) => a.legal_name.localeCompare(b.legal_name))
  );

  // --- Items ---
  addSheet(
    wb, "Items",
    [
      { label: "Item Code", value: "item_code" }, { label: "Description", value: "description" },
      { label: "Base Unit", value: "base_unit" }, { label: "Category", value: "category" },
      { label: "Standard Cost", value: "standard_cost", numFmt: "#,##0.00" }, { label: "Stocked", value: (r) => (r.is_stocked ? "Yes" : "No") },
      { label: "Active", value: (r) => (r.is_active ? "Yes" : "No") },
    ],
    (tables.items ?? []).sort((a, b) => a.item_code.localeCompare(b.item_code))
  );

  // --- Current Stock (running_balance is a per-row cumulative total in stock_ledger,
  //     ordered by created_at, so the latest row per item×warehouse IS the current qty). ---
  const stockByKey = new Map();
  for (const sl of [...(tables.stock_ledger ?? [])].sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""))) {
    stockByKey.set(`${sl.item_id}::${sl.warehouse_id}`, {
      item_id: sl.item_id, warehouse_id: sl.warehouse_id,
      qty: Number(sl.running_balance ?? 0), avg_cost: Number(sl.avg_cost ?? 0),
    });
  }
  addSheet(
    wb, "Current Stock",
    [
      { label: "Item", value: (r) => `${itemById.get(r.item_id)?.item_code ?? "—"} — ${itemById.get(r.item_id)?.description ?? ""}` },
      { label: "Warehouse", value: (r) => whById.get(r.warehouse_id)?.name ?? "—" },
      { label: "Qty on Hand", value: "qty", numFmt: "#,##0.000" }, { label: "Avg Cost", value: "avg_cost", numFmt: "#,##0.00" },
      { label: "Stock Value", value: (r) => r.qty * r.avg_cost, numFmt: "#,##0.00" },
    ],
    Array.from(stockByKey.values()).filter((r) => Math.abs(r.qty) > 0.0005)
  );

  // --- Sales / Purchase Orders, Invoices, Supplier Bills, Payments, Expenses, Jobs, Delivery Challans ---
  addSheet(wb, "Sales Orders",
    [{ label: "SO #", value: "so_no" }, { label: "Client", value: (r) => partyById.get(r.party_id)?.legal_name ?? "—" },
     { label: "Client PO #", value: "client_po_number" }, { label: "Line", value: "business_line" }, { label: "Status", value: "status" },
     { label: "Total", value: "grand_total", numFmt: "#,##0.00" }],
    (tables.sales_orders ?? []).sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")));

  addSheet(wb, "Purchase Orders",
    [{ label: "PO #", value: "po_no" }, { label: "Supplier", value: (r) => partyById.get(r.supplier_id)?.legal_name ?? "—" },
     { label: "Type", value: "purchase_type" }, { label: "Status", value: "status" }, { label: "Total", value: "grand_total", numFmt: "#,##0.00" }],
    (tables.purchase_orders ?? []).sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")));

  addSheet(wb, "Invoices",
    [{ label: "Invoice #", value: "invoice_no" }, { label: "Date", value: "invoice_date" },
     { label: "Client", value: (r) => partyById.get(r.party_id)?.legal_name ?? "—" }, { label: "Status", value: "status" },
     { label: "Total", value: "grand_total", numFmt: "#,##0.00" },
     { label: "Outstanding", value: (r) => Number(r.grand_total ?? 0) - (paidByInvoice.get(r.id) ?? 0), numFmt: "#,##0.00" }],
    (tables.invoices ?? []).sort((a, b) => (b.invoice_date ?? "").localeCompare(a.invoice_date ?? "")));

  addSheet(wb, "Supplier Bills",
    [{ label: "Bill #", value: "bill_no" }, { label: "Date", value: "bill_date" },
     { label: "Supplier", value: (r) => partyById.get(r.supplier_id)?.legal_name ?? "—" }, { label: "Status", value: "status" },
     { label: "Total", value: "grand_total", numFmt: "#,##0.00" },
     { label: "Outstanding", value: (r) => Number(r.grand_total ?? 0) - (paidByBill.get(r.id) ?? 0), numFmt: "#,##0.00" }],
    (tables.supplier_bills ?? []).sort((a, b) => (b.bill_date ?? "").localeCompare(a.bill_date ?? "")));

  addSheet(wb, "Payments",
    [{ label: "Payment #", value: "payment_no" }, { label: "Date", value: "payment_date" },
     { label: "Party", value: (r) => partyById.get(r.party_id)?.legal_name ?? "—" }, { label: "Direction", value: "direction" },
     { label: "Amount", value: "amount", numFmt: "#,##0.00" }, { label: "Status", value: "status" }],
    (tables.payments ?? []).sort((a, b) => (b.payment_date ?? "").localeCompare(a.payment_date ?? "")));

  const expenseHeadById = indexBy(tables.expense_heads, "id");
  addSheet(wb, "Expenses",
    [{ label: "Date", value: "expense_date" }, { label: "Head", value: (r) => expenseHeadById.get(r.expense_head_id)?.name ?? "—" },
     { label: "Amount", value: "amount", numFmt: "#,##0.00" }, { label: "Source", value: "payment_source" }, { label: "Description", value: "description" }],
    (tables.expenses ?? []).sort((a, b) => (b.expense_date ?? "").localeCompare(a.expense_date ?? "")));

  addSheet(wb, "Jobs",
    [{ label: "Job #", value: "job_no" }, { label: "Description", value: "description" }, { label: "Qty", value: "job_qty" },
     { label: "Progress %", value: "progress_pct" }, { label: "Status", value: "status" }],
    (tables.jobs ?? []).sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")));

  addSheet(wb, "Delivery Challans",
    [{ label: "DC #", value: "dc_no" }, { label: "Date", value: "delivery_date" },
     { label: "Client", value: (r) => partyById.get(r.party_id)?.legal_name ?? "—" }, { label: "Status", value: "status" },
     { label: "Acceptance", value: "acceptance_status" }],
    (tables.delivery_challans ?? []).sort((a, b) => (b.delivery_date ?? "").localeCompare(a.delivery_date ?? "")));

  // --- Line-item detail: which items, at what rate, on which document ---
  // The sheets above answer "what is invoice INV-0003 worth". These answer
  // "what was ON it". Each line is joined back to its parent document's
  // number and to the item master, so the item shows as its code and
  // description rather than a uuid nobody can read.
  const itemLabel = (id) => {
    const it = itemById.get(id);
    return it ? `${it.item_code}` : "";
  };
  const itemDesc = (id) => itemById.get(id)?.description ?? "";

  function linesSheet(sheetName, lineRows, parentRows, parentFk, parentNoKey, cols) {
    const parentById = indexBy(parentRows, "id");
    const headers = [
      { label: "Document #", value: (r) => parentById.get(r[parentFk])?.[parentNoKey] ?? "—" },
      { label: "Item Code", value: (r) => itemLabel(r.item_id) },
      { label: "Item Description", value: (r) => itemDesc(r.item_id) },
      { label: "Line Description", value: "description" },
      ...cols,
    ];
    const sorted = (lineRows ?? []).slice().sort((a, b) => {
      const an = parentById.get(a[parentFk])?.[parentNoKey] ?? "";
      const bn = parentById.get(b[parentFk])?.[parentNoKey] ?? "";
      return String(bn).localeCompare(String(an)) || (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });
    addSheet(wb, sheetName, headers, sorted);
  }

  const money = "#,##0.00";
  linesSheet("Invoice Lines", tables.invoice_lines, tables.invoices, "invoice_id", "invoice_no", [
    { label: "Qty", value: "qty" }, { label: "Unit", value: "unit" },
    { label: "Rate", value: "rate", numFmt: money }, { label: "Tax %", value: "tax_pct" },
    { label: "Amount", value: "amount", numFmt: money }, { label: "Returned Qty", value: "returned_qty" },
  ]);

  linesSheet("Sales Order Lines", tables.sales_order_lines, tables.sales_orders, "sales_order_id", "so_no", [
    { label: "Ordered Qty", value: "ordered_qty" }, { label: "Unit", value: "unit" },
    { label: "Rate", value: "rate", numFmt: money }, { label: "Tax %", value: "tax_pct" },
    { label: "Amount", value: "amount", numFmt: money },
    { label: "Delivered Qty", value: "delivered_qty" }, { label: "Invoiced Qty", value: "invoiced_qty" },
  ]);

  linesSheet("Purchase Order Lines", tables.purchase_order_lines, tables.purchase_orders, "purchase_order_id", "po_no", [
    { label: "Ordered Qty", value: "ordered_qty" }, { label: "Unit", value: "unit" },
    { label: "Rate", value: "rate", numFmt: money }, { label: "Tax %", value: "tax_pct" },
    { label: "Amount", value: "amount", numFmt: money }, { label: "Received Qty", value: "received_qty" },
  ]);

  linesSheet("Supplier Bill Lines", tables.supplier_bill_lines, tables.supplier_bills, "supplier_bill_id", "bill_no", [
    { label: "Qty", value: "qty" },
    { label: "Rate", value: "rate", numFmt: money }, { label: "Tax %", value: "tax_pct" },
    { label: "Amount", value: "amount", numFmt: money }, { label: "Returned Qty", value: "returned_qty" },
  ]);

  linesSheet("Delivery Challan Lines", tables.delivery_challan_lines, tables.delivery_challans, "dc_id", "dc_no", [
    { label: "Delivered Qty", value: "delivered_qty" }, { label: "Unit", value: "unit" },
    { label: "Issued From Stock", value: (r) => (r.issue_from_stock ? "Yes" : "No") },
    { label: "Stock Qty", value: "stock_qty" },
  ]);

  linesSheet("GRN Lines", tables.grn_lines, tables.grns, "grn_id", "grn_no", [
    { label: "Ordered Qty", value: "ordered_qty" }, { label: "This Receipt Qty", value: "this_receipt_qty" },
    { label: "Total Received", value: "total_received_qty" }, { label: "Short/Excess", value: "short_excess_qty" },
    { label: "Unit", value: "unit" }, { label: "Rate", value: "rate", numFmt: money },
    { label: "Tax %", value: "tax_pct" },
  ]);

  linesSheet("Quotation Lines", tables.quotation_lines, tables.quotation_revisions, "revision_id", "rev_no", [
    { label: "Qty", value: "qty" }, { label: "Unit", value: "unit" },
    { label: "Rate", value: "rate", numFmt: money }, { label: "Tax %", value: "tax_pct" },
    { label: "Amount", value: "amount", numFmt: money },
  ]);

  // --- Complete raw dump: every table, every column, every row ---
  // Nothing curated, nothing dropped. Whatever the summary and detail
  // sheets above do not show, this does.
  const used = new Set(wb.worksheets.map((w) => w.name.toLowerCase()));
  const rawIndex = [];
  for (const table of TABLE_ORDER) {
    rawIndex.push({ table, ...addRawSheet(wb, used, table, tables[table]) });
  }

  // --- Fill the Contents sheet created at the top ---
  contents.addRow(["Sheet", "Contents", "Rows", "Columns"]);
  contents.getRow(1).font = { bold: true };
  contents.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E2D4" } };
  for (const w of wb.worksheets) {
    if (w.name === "Contents") continue;
    const raw = rawIndex.find((r) => r.name === w.name);
    contents.addRow([
      w.name,
      raw ? `Complete table: ${raw.table}` : "Report / summary",
      raw ? raw.rows : Math.max(w.rowCount - 1, 0),
      raw ? raw.cols : w.columnCount,
    ]);
  }
  autoWidth(contents);

  return wb;
}

// ---------- JSON (machine-readable restore file) ----------
function buildRestoreJson(tables, missed, dateStr) {
  const counts = {};
  for (const t of TABLE_ORDER) counts[t] = (tables[t] ?? []).length;
  return {
    format: "hitech-restore",
    version: 1,
    taken_at: new Date().toISOString(),
    taken_at_karachi: takenAtText(),
    data_date: dateStr,
    order: TABLE_ORDER,
    missed: missed.map((m) => m.table),
    missed_detail: missed,
    counts,
    tables,
  };
}

// ---------- Email ----------
async function sendEmail({ dateStr, missed, excelBuffer, jsonBuffer }) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });

  const incomplete = missed.length > 0;
  const subject = `${incomplete ? "⚠ INCOMPLETE — " : ""}${APP_NAME} Daily Backup — ${dateStr}`;
  const lines = [
    `${APP_NAME} Daily Backup — data for ${dateStr}.`,
    `Backup ran at: ${takenAtText()}.`,
    "",
    "Two files are attached:",
    `  1. ${APP_NAME}-Backup-${dateStr}.xlsx — human-readable (ledgers, invoices, stock, parties, etc.)`,
    `  2. ${APP_NAME}-Restore-${dateStr}.json — raw data for the in-app Restore feature (Setup → Backup & Restore). Keep this file safe.`,
  ];
  if (incomplete) {
    lines.push("", "⚠ The following table(s) FAILED to back up and are NOT included in this file:");
    for (const m of missed) lines.push(`  - ${m.table}: ${m.reason}`);
    lines.push("", "Please investigate before relying on this backup for a full restore.");
  }

  await transporter.sendMail({
    from: GMAIL_USER,
    to: BACKUP_TO_EMAIL,
    subject,
    text: lines.join("\n"),
    attachments: [
      { filename: `${APP_NAME}-Backup-${dateStr}.xlsx`, content: excelBuffer },
      { filename: `${APP_NAME}-Restore-${dateStr}.json`, content: jsonBuffer },
    ],
  });
}

// ---------- Main ----------
async function main() {
  const dateStr = dataDate();
  console.log(`[backup] starting — data date ${dateStr}, taken at ${takenAtText()}`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { error: signInError } = await supabase.auth.signInWithPassword({ email: BACKUP_EMAIL, password: BACKUP_PASSWORD });
  if (signInError) {
    console.error("[backup] Backup Bot sign-in failed:", signInError.message);
    process.exit(1);
  }

  const { tables, missed } = await fetchAll(supabase);
  console.log(`[backup] fetched ${TABLE_ORDER.length} tables, ${missed.length} failed`);

  const workbook = buildExcel(tables);
  const excelBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const jsonBuffer = Buffer.from(JSON.stringify(buildRestoreJson(tables, missed, dateStr), null, 2));

  await sendEmail({ dateStr, missed, excelBuffer, jsonBuffer });
  console.log(`[backup] email sent to ${BACKUP_TO_EMAIL}`);

  if (missed.length > 0) {
    console.error(`[backup] completed WITH FAILURES: ${missed.map((m) => m.table).join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log("[backup] completed successfully — no failures.");
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[backup] FATAL:", err);
    process.exit(1);
  });
} else {
  // Exposed for verification tooling only — `node backup.js` still runs main() as normal.
  module.exports = { TABLE_ORDER, fetchAll, buildExcel, buildRestoreJson, dataDate, takenAtText };
}
