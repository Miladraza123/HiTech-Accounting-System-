export const SHEET_STATUS_STYLE: Record<string, string> = {
  Draft: "bg-warn-soft text-warn",
  Finalized: "bg-accent-soft text-accent-ink",
  Paid: "bg-good-soft text-good",
  Cancelled: "bg-surface-2 text-ink-faint",
};

export function money(n: number | string | null | undefined): string {
  return `Rs\u00a0${Number(n ?? 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function days(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export type SalaryDay = {
  d: string;
  k: "work" | "off" | "holiday";
  s: string;
  g: string | null;
  wv: number;
  pl: number;
  ul: number;
  net: number;
  late: number;
  early: number;
  ot: number;
  sw: boolean;
  pay: number;
  otpay: number;
};

export function sheetLabel(s: { kind: string; wager_cycle: string | null }): string {
  return s.kind === "monthly" ? "Monthly" : `Daily wagers (${s.wager_cycle})`;
}
