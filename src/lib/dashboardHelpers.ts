// Shared helpers for the Owner Dashboard (/reports) — date-range resolution
// (Today/This Week/This Month/Custom) and daily/weekly bucketing for the
// trend charts. Kept framework-free (no Supabase/Next imports) so it can be
// unit-tested like aging.ts/orderHealth.ts if that's ever needed.

export type DashRangeKey = "today" | "week" | "month" | "custom";

export type ResolvedRange = {
  range: DashRangeKey;
  from: string; // YYYY-MM-DD, inclusive
  to: string; // YYYY-MM-DD, inclusive
  label: string;
};

export const RANGE_LABEL: Record<DashRangeKey, string> = {
  today: "Aaj",
  week: "Is Hafta",
  month: "Is Mahine",
  custom: "Custom",
};

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isValidISODate(s: string | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Resolves the Today/This Week/This Month/Custom filter into a concrete [from, to] date pair. */
export function resolveRange(rangeParam: string | undefined, fromParam?: string, toParam?: string): ResolvedRange {
  const today = new Date();
  const todayStr = toISODate(today);

  if (rangeParam === "custom") {
    if (isValidISODate(fromParam) && isValidISODate(toParam) && fromParam <= toParam) {
      return { range: "custom", from: fromParam, to: toParam, label: `${fromParam} se ${toParam}` };
    }
    // Invalid/incomplete custom range — fall back to This Month rather than erroring.
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    return { range: "month", from: toISODate(first), to: todayStr, label: RANGE_LABEL.month };
  }

  if (rangeParam === "week") {
    const day = today.getDay(); // 0=Sun..6=Sat
    const diffToMonday = day === 0 ? 6 : day - 1;
    const monday = new Date(today);
    monday.setDate(today.getDate() - diffToMonday);
    return { range: "week", from: toISODate(monday), to: todayStr, label: RANGE_LABEL.week };
  }

  if (rangeParam === "month") {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    return { range: "month", from: toISODate(first), to: todayStr, label: RANGE_LABEL.month };
  }

  return { range: "today", from: todayStr, to: todayStr, label: RANGE_LABEL.today };
}

/** [from, to+1day) — an exclusive upper bound, safe for `.gte(created_at, from).lt(created_at, toExclusive)` filters against timestamp columns. */
export function toExclusiveUpperBound(to: string): string {
  const d = new Date(to + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return toISODate(d);
}

export type TimeBucket = { start: string; end: string; label: string };

/** Daily buckets for a range up to 31 days; weekly (7-day) buckets beyond that, so a large Custom range still renders a readable chart. */
export function buildTimeBuckets(from: string, to: string): TimeBucket[] {
  const fromD = new Date(from + "T00:00:00Z");
  const toD = new Date(to + "T00:00:00Z");
  const totalDays = Math.max(1, Math.round((toD.getTime() - fromD.getTime()) / 86400000) + 1);
  const buckets: TimeBucket[] = [];

  if (totalDays <= 31) {
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(fromD);
      d.setUTCDate(d.getUTCDate() + i);
      const iso = toISODate(d);
      buckets.push({ start: iso, end: iso, label: iso.slice(5) });
    }
  } else {
    let cursor = new Date(fromD);
    while (cursor.getTime() <= toD.getTime()) {
      const start = toISODate(cursor);
      const endD = new Date(cursor);
      endD.setUTCDate(endD.getUTCDate() + 6);
      if (endD.getTime() > toD.getTime()) endD.setTime(toD.getTime());
      const end = toISODate(endD);
      buckets.push({ start, end, label: start.slice(5) });
      cursor = new Date(endD);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  return buckets;
}

/** Counts how many of the given date-ish strings (YYYY-MM-DD or full timestamps) fall in each bucket. */
export function countInBuckets(dateStrings: (string | null | undefined)[], buckets: TimeBucket[]): number[] {
  const days = dateStrings.filter((d): d is string => !!d).map((d) => d.slice(0, 10));
  return buckets.map((b) => days.filter((d) => d >= b.start && d <= b.end).length);
}
