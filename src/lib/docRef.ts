// Document references and small formatters shared by the Quotation and Service
// Invoice print layouts.

/** Normalises a short code the way the database checks it: upper case letters and digits, 2 to 10 long. */
export function normalizeShortCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidShortCode(code: string): boolean {
  return /^[A-Z0-9]{2,10}$/.test(code);
}

/**
 * The running serial at the end of a document number:
 * "QTN-202627-0012" -> 12, "SRB 007" -> 7. Null when there is none.
 */
export function serialOf(docNo: string): number | null {
  const m = docNo.match(/(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

/**
 * Quotation reference "HTE/TPFL/0012": company code / client code / 4-digit serial.
 * Falls back to the plain quotation number until both codes exist, so a
 * printout never shows a half-built reference.
 */
export function quotationRef(companyCode: string | null | undefined, partyCode: string | null | undefined, quotationNo: string): string {
  const serial = serialOf(quotationNo);
  if (!companyCode || !partyCode || serial === null) return quotationNo;
  return `${companyCode}/${partyCode}/${String(serial).padStart(4, "0")}`;
}

/** 4800 -> "4,800", 19200.5 -> "19,200.50": whole numbers without decimals, others with two. */
export function formatAmount(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "0";
  const whole = Math.abs(v - Math.round(v)) < 0.005;
  return v.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
}

/** "2026-10-06" -> "6-Oct-26" (quotation date). */
export function formatQuoteDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const mon = d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  return `${d.getUTCDate()}-${mon}-${String(d.getUTCFullYear()).slice(2)}`;
}

/** "2026-10-06" -> "6/10/2026" (service invoice date). */
export function formatInvoiceDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`;
}

/** Whole days from the quotation date to the validity date, never negative. Null when there is no validity date. */
export function validityDays(createdAt: string, validityDate: string | null | undefined): number | null {
  if (!validityDate) return null;
  const from = Date.parse(`${createdAt.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${validityDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.max(Math.round((to - from) / 86400000), 0);
}
