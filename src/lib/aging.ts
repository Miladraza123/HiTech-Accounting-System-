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
