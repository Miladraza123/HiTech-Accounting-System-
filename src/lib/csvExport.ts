// Client-only CSV export — used by "Export Selected" on list pages.
// Deliberately no library: this is one small, well-understood format
// (RFC 4180-ish escaping) and pulling in a dependency for it isn't
// warranted.
//
// Formula injection: a cell starting with = + - @ (or a tab / CR) is run as a
// formula by Excel/Sheets, so a party name like `=HYPERLINK(...)` typed into
// the app could execute on whoever opens the export. Such values get a
// leading single quote, which spreadsheets treat as "this is text". Plain
// numbers (including negatives like -1500.50) are left alone so amounts stay
// numeric — a bare number can't carry a formula.
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(?:\.\d+)?$/;

export function escapeCsvField(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (typeof value !== "number" && FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) {
    s = `'${s}`;
  }
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(escapeCsvField).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCsvField).join(","));
  }
  // Leading BOM so Excel opens UTF-8 content (currency symbols, etc.) correctly.
  return "﻿" + lines.join("\r\n");
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]): void {
  const csv = toCsv(headers, rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
