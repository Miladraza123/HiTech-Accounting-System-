"use client";

import { useState } from "react";
import Papa from "papaparse";
import {
  commitPartiesImportAction,
  commitOpeningBalancesImportAction,
  commitOpeningStockImportAction,
  parseExcelFileAction,
  type ImportResult,
} from "@/app/actions/import";

type EntityType = "clients" | "suppliers" | "opening_receivables" | "opening_payables" | "opening_stock";

const ENTITIES: { value: EntityType; label: string; columns: string[]; sample: string[][] }[] = [
  {
    value: "clients",
    label: "Clients",
    columns: ["legal_name", "ntn", "strn", "cnic", "billing_address", "province", "credit_limit", "credit_days"],
    sample: [
      ["legal_name", "ntn", "strn", "cnic", "billing_address", "province", "credit_limit", "credit_days"],
      ["Al-Karam Steel Traders", "1234567-8", "", "", "Shahrah-e-Faisal, Karachi", "SD", "500000", "30"],
    ],
  },
  {
    value: "suppliers",
    label: "Suppliers",
    columns: ["legal_name", "ntn", "strn", "cnic", "billing_address", "province", "credit_limit", "credit_days"],
    sample: [
      ["legal_name", "ntn", "strn", "cnic", "billing_address", "province", "credit_limit", "credit_days"],
      ["Punjab Steel Mills", "9876543-2", "", "", "Sundar Industrial Estate, Lahore", "PB", "0", "15"],
    ],
  },
  {
    value: "opening_receivables",
    label: "Opening Receivables (clients ke pichle bakaya)",
    columns: ["party_name", "amount", "as_of_date", "narration"],
    sample: [
      ["party_name", "amount", "as_of_date", "narration"],
      ["Al-Karam Steel Traders", "250000", "2026-06-30", "Purani invoice ka bacha hua"],
    ],
  },
  {
    value: "opening_payables",
    label: "Opening Payables (suppliers ka pichla bakaya)",
    columns: ["party_name", "amount", "as_of_date", "narration"],
    sample: [
      ["party_name", "amount", "as_of_date", "narration"],
      ["Punjab Steel Mills", "180000", "2026-06-30", "Purani bill ka bacha hua"],
    ],
  },
  {
    value: "opening_stock",
    label: "Opening Stock (existing raw material / warehouse stock)",
    columns: ["item_code", "warehouse_code", "qty", "rate", "as_of_date", "notes"],
    sample: [
      ["item_code", "warehouse_code", "qty", "rate", "as_of_date", "notes"],
      ["MS-PLATE-6MM", "WH-01", "500", "185.50", "2026-06-30", "Physical count se pehle"],
    ],
  },
];

type Row = Record<string, string>;

export function ImportWizard() {
  const [entity, setEntity] = useState<EntityType>("clients");
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const config = ENTITIES.find((e) => e.value === entity)!;

  async function handleFile(file: File) {
    setResult(null);
    setParseError(null);
    setParsing(true);
    setFileName(file.name);
    try {
      let parsedRows: Row[] = [];
      if (file.name.toLowerCase().endsWith(".csv")) {
        const text = await file.text();
        const parsed = Papa.parse<Row>(text, { header: true, skipEmptyLines: true });
        parsedRows = parsed.data;
      } else {
        const fd = new FormData();
        fd.set("file", file);
        const { rows: excelRows, error } = await parseExcelFileAction(fd);
        if (error) {
          setParseError(error);
          return;
        }
        parsedRows = excelRows;
      }
      setRows(parsedRows.filter((r) => Object.values(r).some((v) => v && v.trim())));
    } catch {
      setParseError("File parse nahi ho saki. CSV ya .xlsx file check karen.");
    } finally {
      setParsing(false);
    }
  }

  function downloadTemplate() {
    const csv = Papa.unparse(config.sample);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${entity}_template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleCommit() {
    setCommitting(true);
    setResult(null);
    try {
      let res: ImportResult;
      if (entity === "clients" || entity === "suppliers") {
        res = await commitPartiesImportAction(
          entity,
          rows.map((r) => ({
            legal_name: r.legal_name,
            party_type: entity === "clients" ? "client" : "supplier",
            ntn: r.ntn,
            strn: r.strn,
            cnic: r.cnic,
            billing_address: r.billing_address,
            province: r.province,
            credit_limit: r.credit_limit ? Number(r.credit_limit) : undefined,
            credit_days: r.credit_days ? Number(r.credit_days) : undefined,
          }))
        );
      } else if (entity === "opening_stock") {
        res = await commitOpeningStockImportAction(
          rows.map((r) => ({
            item_code: r.item_code,
            warehouse_code: r.warehouse_code,
            qty: Number(r.qty),
            rate: Number(r.rate) || 0,
            as_of_date: r.as_of_date,
            notes: r.notes,
          }))
        );
      } else {
        res = await commitOpeningBalancesImportAction(
          entity,
          rows.map((r) => ({
            party_name: r.party_name,
            amount: Number(r.amount),
            as_of_date: r.as_of_date,
            narration: r.narration,
          }))
        );
      }
      setResult(res);
      if (res.importedCount > 0) setRows([]);
    } finally {
      setCommitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-line bg-surface p-5 space-y-4">
        <div>
          <label className="text-xs font-medium text-ink-soft">Kya import karna hai?</label>
          <select
            value={entity}
            onChange={(e) => {
              setEntity(e.target.value as EntityType);
              setRows([]);
              setResult(null);
            }}
            className="input mt-1.5"
          >
            {ENTITIES.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </select>
        </div>

        <p className="text-xs text-ink-faint">
          File mein yeh columns honay chahiye: <span className="font-mono">{config.columns.join(", ")}</span>
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center rounded-md border border-line-strong bg-bg px-3 py-1.5 text-sm text-ink hover:bg-surface-2 transition">
            <input
              type="file"
              accept=".csv,.xlsx"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
            CSV / Excel file chunen
          </label>
          <button type="button" onClick={downloadTemplate} className="text-xs text-accent-ink underline underline-offset-2">
            Sample template download karen
          </button>
          {fileName && <span className="text-xs text-ink-faint">{fileName}</span>}
        </div>

        {parsing && <p className="text-sm text-ink-soft">File parse ho rahi hai…</p>}
        {parseError && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{parseError}</p>}
      </div>

      {rows.length > 0 && (
        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line">
            <p className="text-sm text-ink">
              <span className="font-medium">{rows.length}</span> rows mili — commit karne se pehle preview
              (pehli 10):
            </p>
            <button
              type="button"
              onClick={handleCommit}
              disabled={committing}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
            >
              {committing ? "Import ho raha hai…" : `${rows.length} rows Import Karen`}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-surface-2 font-mono uppercase tracking-wide text-ink-faint">
                <tr>
                  {config.columns.map((c) => (
                    <th key={c} className="text-left px-3 py-2 whitespace-nowrap">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 10).map((r, i) => (
                  <tr key={i} className="border-t border-line">
                    {config.columns.map((c) => (
                      <td key={c} className="px-3 py-1.5 text-ink-soft whitespace-nowrap">
                        {r[c] || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result && (
        <div className="rounded-xl border border-line bg-surface p-5 space-y-2">
          <p className="text-sm text-good">{result.importedCount} rows kamiyabi se import hui.</p>
          {result.rowErrors.length > 0 && (
            <div className="text-sm text-bad space-y-1">
              <p className="font-medium">{result.rowErrors.length} rows mein masla hua:</p>
              <ul className="list-disc list-inside space-y-0.5">
                {result.rowErrors.slice(0, 20).map((e, i) => (
                  <li key={i}>
                    Row {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
