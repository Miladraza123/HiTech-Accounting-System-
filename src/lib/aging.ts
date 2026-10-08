// Shared AR/AP aging-bucket logic — used by the Customer 360 profile
// and the AR Aging / AP Aging reports so all three always bucket the
// same way. "Current" means not yet past its due date; the rest are
// standard 30-day overdue bands.
export type AgingBucketKey = "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus";

export type Buckets = Record<AgingBucketKey, number>;

export function emptyBuckets(): Buckets {
  return { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
}

/** Which bucket a due date (YYYY-MM-DD) falls into, as of right now. */
export function agingBucket(dueDate: string): AgingBucketKey {
  const days = Math.floor((Date.now() - new Date(dueDate).getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "current";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_plus";
}

/** invoice_date/bill_date + credit_days (Pakistan-style net terms) -> due date, YYYY-MM-DD. */
export function dueDateFrom(docDate: string, creditDays: number): string {
  const d = new Date(docDate);
  d.setDate(d.getDate() + (creditDays ?? 0));
  return d.toISOString().slice(0, 10);
}

export function bucketTotal(b: Buckets): number {
  return b.current + b.d1_30 + b.d31_60 + b.d61_90 + b.d90_plus;
}

/**
 * One row of fn_ar_aging / fn_ap_aging (phase46_02). The bucket columns
 * cover open invoices / supplier bills only; opening_balance (opening and
 * manual party journal entries on 1200/2100), unapplied (Posted payments
 * not yet allocated) and net = total + opening_balance - unapplied make the
 * report tie to the control account. Declared here until
 * src/lib/supabase/database.types.ts is regenerated with the new columns.
 */
export type AgingReportRow = {
  party_id: string;
  name: string | null;
  bucket_current: number;
  bucket_1_30: number;
  bucket_31_60: number;
  bucket_61_90: number;
  bucket_90_plus: number;
  total: number;
  opening_balance: number;
  unapplied: number;
  net: number;
};

/** Narrow the untyped-extra-columns RPC result to AgingReportRow[]. */
export function asAgingRows(data: unknown): AgingReportRow[] {
  return ((data ?? []) as Partial<AgingReportRow>[]).map((r) => ({
    party_id: r.party_id ?? "",
    name: r.name ?? null,
    bucket_current: Number(r.bucket_current ?? 0),
    bucket_1_30: Number(r.bucket_1_30 ?? 0),
    bucket_31_60: Number(r.bucket_31_60 ?? 0),
    bucket_61_90: Number(r.bucket_61_90 ?? 0),
    bucket_90_plus: Number(r.bucket_90_plus ?? 0),
    total: Number(r.total ?? 0),
    opening_balance: Number(r.opening_balance ?? 0),
    unapplied: Number(r.unapplied ?? 0),
    net: Number(r.net ?? 0),
  }));
}
