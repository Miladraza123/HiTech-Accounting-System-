"use client";

import { useRef, useState } from "react";
import Papa from "papaparse";
import {
  commitPartiesImportAction,
  commitOpeningBalancesImportAction,
  commitOpeningStockImportAction,
  parseExcelFileAction,
  type ImportResult,
} from "@/app/actions/import";
import {
  getAttendanceImportLookupsAction,
  importAttendanceChunkAction,
  recordAttendanceImportBatchAction,
  type AttendanceImportRow,
} from "@/app/actions/hr";

type EntityType = "clients" | "suppliers" | "opening_receivables" | "opening_payables" | "opening_stock" | "attendance";

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
    label: "Opening Receivables (outstanding balances owed by clients)",
    columns: ["party_name", "amount", "as_of_date", "narration"],
    sample: [
      ["party_name", "amount", "as_of_date", "narration"],
      ["Al-Karam Steel Traders", "250000", "2026-06-30", "Remaining balance from an old invoice"],
    ],
  },
  {
    value: "opening_payables",
    label: "Opening Payables (outstanding balances owed to suppliers)",
    columns: ["party_name", "amount", "as_of_date", "narration"],
    sample: [
      ["party_name", "amount", "as_of_date", "narration"],
      ["Punjab Steel Mills", "180000", "2026-06-30", "Remaining balance from an old bill"],
    ],
  },
  {
    value: "opening_stock",
    label: "Opening Stock (existing raw material / warehouse stock)",
    columns: ["item_code", "warehouse_code", "qty", "rate", "as_of_date", "notes"],
    sample: [
      ["item_code", "warehouse_code", "qty", "rate", "as_of_date", "notes"],
      ["MS-PLATE-6MM", "WH-01", "500", "185.50", "2026-06-30", "Before physical count"],
    ],
  },
  {
    value: "attendance",
    label: "Attendance (historical backfill — e.g. an old date range)",
    columns: ["employee_code", "work_date", "mark", "check_in", "check_out", "leave_type", "leave_fraction", "note"],
    sample: [
      ["employee_code", "work_date", "mark", "check_in", "check_out", "leave_type", "leave_fraction", "note"],
      ["01", "2026-01-05", "Present", "09:00", "18:00", "", "", ""],
      ["01", "2026-01-06", "Leave", "", "", "Casual Leave", "1", "Family function"],
      ["02", "2026-01-05", "Absent", "", "", "", "", ""],
    ],
  },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const ATTENDANCE_CHUNK_SIZE = 50;

type Row = Record<string, string>;

export function ImportWizard({ canImportParties, canImportAttendance }: { canImportParties: boolean; canImportAttendance: boolean }) {
  const entities = ENTITIES.filter((e) => {
    if ((e.value === "clients" || e.value === "suppliers") && !canImportParties) return false;
    if (e.value === "attendance" && !canImportAttendance) return false;
    return true;
  });
  const [entity, setEntity] = useState<EntityType>(entities[0].value);
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const config = entities.find((e) => e.value === entity)!;

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
      setParseError("Failed to parse the file. Please check the CSV or .xlsx file.");
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

  // A ref, not just the `committing` state: two fast clicks can both run
  // before React re-renders the disabled button, and every commit posts
  // real ledger entries.
  const commitInFlight = useRef(false);

  // Attendance is structurally different from the other entity types — it
  // spans many employee+date rows that each need their own pass/fail (see
  // importAttendanceChunkAction), not one bulk RPC call — so it gets its own
  // commit path rather than forcing it through the shared one below.
  async function handleAttendanceCommit() {
    setProgress(null);
    const lookups = await getAttendanceImportLookupsAction();
    const employeeIdByCode = new Map(lookups.employees.map((e) => [e.code.trim().toLowerCase(), e.id]));
    const leaveTypeIdByName = new Map(lookups.leaveTypes.map((t) => [t.name.trim().toLowerCase(), t.id]));

    const rowErrors: { row: number; message: string }[] = [];
    const resolved: { originalRow: number; data: AttendanceImportRow }[] = [];

    rows.forEach((r, i) => {
      const rowNum = i + 1;
      const code = (r.employee_code ?? "").trim();
      const workDate = (r.work_date ?? "").trim();
      const markRaw = (r.mark ?? "").trim().toLowerCase();
      if (!code) return rowErrors.push({ row: rowNum, message: "Employee code is empty — row skipped." });
      const employeeId = employeeIdByCode.get(code.toLowerCase());
      if (!employeeId) return rowErrors.push({ row: rowNum, message: `Employee code "${code}" not found — row skipped.` });
      if (!DATE_RE.test(workDate)) return rowErrors.push({ row: rowNum, message: "work_date must be YYYY-MM-DD — row skipped." });
      if (!["present", "absent", "leave"].includes(markRaw)) {
        return rowErrors.push({ row: rowNum, message: `mark must be Present, Absent or Leave (got "${r.mark}") — row skipped.` });
      }
      const checkIn = (r.check_in ?? "").trim() || null;
      const checkOut = (r.check_out ?? "").trim() || null;
      if (checkIn && !TIME_RE.test(checkIn)) return rowErrors.push({ row: rowNum, message: "check_in must be like 09:00 — row skipped." });
      if (checkOut && !TIME_RE.test(checkOut)) return rowErrors.push({ row: rowNum, message: "check_out must be like 18:00 — row skipped." });

      let leaveTypeId: string | null = null;
      let leaveFraction: number | null = null;
      if (markRaw === "leave") {
        const leaveTypeName = (r.leave_type ?? "").trim();
        if (!leaveTypeName) return rowErrors.push({ row: rowNum, message: "leave_type is required for a Leave row — row skipped." });
        const lt = leaveTypeIdByName.get(leaveTypeName.toLowerCase());
        if (!lt) return rowErrors.push({ row: rowNum, message: `Leave type "${leaveTypeName}" not found — row skipped.` });
        leaveTypeId = lt;
        const fractionRaw = (r.leave_fraction ?? "").trim();
        leaveFraction = fractionRaw ? Number(fractionRaw) : 1;
        if (leaveFraction !== 0.5 && leaveFraction !== 1) {
          return rowErrors.push({ row: rowNum, message: "leave_fraction must be 1 (full day) or 0.5 (half day) — row skipped." });
        }
      }

      resolved.push({
        originalRow: rowNum,
        data: {
          employee_id: employeeId,
          work_date: workDate,
          mark: markRaw as "present" | "absent" | "leave",
          check_in: checkIn,
          check_out: checkOut,
          leave_type_id: leaveTypeId,
          leave_fraction: leaveFraction,
          note: (r.note ?? "").trim() || null,
        },
      });
    });

    let importedCount = 0;
    setProgress({ done: 0, total: resolved.length });
    for (let i = 0; i < resolved.length; i += ATTENDANCE_CHUNK_SIZE) {
      const batch = resolved.slice(i, i + ATTENDANCE_CHUNK_SIZE);
      const chunkResults = await importAttendanceChunkAction(batch.map((b) => b.data));
      chunkResults.forEach((res, j) => {
        if (res.ok) importedCount++;
        else rowErrors.push({ row: batch[j].originalRow, message: res.message ?? "Failed." });
      });
      setProgress({ done: Math.min(i + ATTENDANCE_CHUNK_SIZE, resolved.length), total: resolved.length });
    }

    await recordAttendanceImportBatchAction(rows.length, importedCount, rowErrors);
    rowErrors.sort((a, b) => a.row - b.row);
    setResult({ error: null, importedCount, rowErrors });
    if (importedCount > 0) setRows([]);
    setProgress(null);
  }

  async function handleCommit() {
    if (commitInFlight.current) return;
    commitInFlight.current = true;
    setCommitting(true);
    setResult(null);
    try {
      if (entity === "attendance") {
        await handleAttendanceCommit();
        return;
      }
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
      commitInFlight.current = false;
      setCommitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-line bg-surface p-5 space-y-4">
        <div>
          <label className="text-xs font-medium text-ink-soft">What do you want to import?</label>
          <select
            value={entity}
            onChange={(e) => {
              setEntity(e.target.value as EntityType);
              setRows([]);
              setResult(null);
            }}
            className="input mt-1.5"
          >
            {entities.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </select>
        </div>

        <p className="text-xs text-ink-faint">
          The file should have these columns: <span className="font-mono">{config.columns.join(", ")}</span>
        </p>
        {entity === "attendance" && (
          <p className="text-xs text-ink-faint">
            employee_code must match an existing employee&apos;s Code. mark is one of Present / Absent / Leave. For a
            Leave row, leave_type must match an existing Leave Type&apos;s name exactly, and leave_fraction is 1 (full
            day, default) or 0.5 (half day). check_in/check_out are optional, like 09:00. A row already entered for
            that employee+date gets overwritten, not duplicated — safe to re-upload the same file.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center rounded-md border border-line-strong bg-bg px-3 py-1.5 text-sm text-ink hover:bg-surface-2 transition">
            <input
              type="file"
              accept=".csv,.xlsx"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
            Choose CSV / Excel file
          </label>
          <button type="button" onClick={downloadTemplate} className="text-xs text-accent-ink underline underline-offset-2">
            Download sample template
          </button>
          {fileName && <span className="text-xs text-ink-faint">{fileName}</span>}
        </div>

        {parsing && <p className="text-sm text-ink-soft">Parsing file…</p>}
        {parseError && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{parseError}</p>}
      </div>

      {rows.length > 0 && (
        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line">
            <p className="text-sm text-ink">
              <span className="font-medium">{rows.length}</span> rows found — preview before committing
              (first 10):
            </p>
            <button
              type="button"
              onClick={handleCommit}
              disabled={committing}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
            >
              {committing ? (progress ? `Importing… ${progress.done}/${progress.total}` : "Importing…") : `Import ${rows.length} rows`}
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
          <p className="text-sm text-good">{result.importedCount} rows imported successfully.</p>
          {result.rowErrors.length > 0 && (
            <div className="text-sm text-bad space-y-1">
              <p className="font-medium">{result.rowErrors.length} rows had errors:</p>
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
