import { describe, it, expect } from "vitest";
import { resolveRange, toExclusiveUpperBound, buildTimeBuckets, countInBuckets } from "./dashboardHelpers";

describe("resolveRange", () => {
  it("defaults to Today when no range is given", () => {
    const today = new Date().toISOString().slice(0, 10);
    const r = resolveRange(undefined);
    expect(r.range).toBe("today");
    expect(r.from).toBe(today);
    expect(r.to).toBe(today);
  });

  it("This Week resolves to Monday through today", () => {
    const r = resolveRange("week");
    expect(r.range).toBe("week");
    const monday = new Date(r.from + "T00:00:00Z");
    expect(monday.getUTCDay()).toBe(1); // Monday
    expect(r.to).toBe(new Date().toISOString().slice(0, 10));
  });

  it("This Month resolves to the 1st of the current month through today", () => {
    const r = resolveRange("month");
    expect(r.range).toBe("month");
    expect(r.from.endsWith("-01")).toBe(true);
    expect(r.to).toBe(new Date().toISOString().slice(0, 10));
  });

  it("accepts a valid Custom range", () => {
    const r = resolveRange("custom", "2026-01-01", "2026-01-31");
    expect(r).toEqual({ range: "custom", from: "2026-01-01", to: "2026-01-31", label: "2026-01-01 to 2026-01-31" });
  });

  it("falls back to This Month when Custom is invalid (from after to)", () => {
    const r = resolveRange("custom", "2026-02-01", "2026-01-01");
    expect(r.range).toBe("month");
  });

  it("falls back to This Month when Custom is missing dates", () => {
    const r = resolveRange("custom");
    expect(r.range).toBe("month");
  });
});

describe("toExclusiveUpperBound", () => {
  it("returns the day after the given date", () => {
    expect(toExclusiveUpperBound("2026-01-31")).toBe("2026-02-01");
    expect(toExclusiveUpperBound("2026-09-12")).toBe("2026-09-13");
  });
});

describe("buildTimeBuckets", () => {
  it("builds one daily bucket per day for a short range", () => {
    const buckets = buildTimeBuckets("2026-01-01", "2026-01-05");
    expect(buckets).toHaveLength(5);
    expect(buckets[0]).toEqual({ start: "2026-01-01", end: "2026-01-01", label: "01-01" });
    expect(buckets[4].start).toBe("2026-01-05");
  });

  it("a single-day range yields exactly one bucket", () => {
    const buckets = buildTimeBuckets("2026-01-01", "2026-01-01");
    expect(buckets).toEqual([{ start: "2026-01-01", end: "2026-01-01", label: "01-01" }]);
  });

  it("switches to weekly buckets beyond 31 days, and the last bucket is clipped to `to`", () => {
    const buckets = buildTimeBuckets("2026-01-01", "2026-03-01"); // 60 days
    expect(buckets.length).toBeGreaterThan(1);
    expect(buckets.length).toBeLessThan(60);
    expect(buckets[0]).toEqual({ start: "2026-01-01", end: "2026-01-07", label: "01-01" });
    expect(buckets[buckets.length - 1].end).toBe("2026-03-01");
  });
});

describe("countInBuckets", () => {
  it("counts full timestamps and plain dates into the right daily bucket", () => {
    const buckets = buildTimeBuckets("2026-01-01", "2026-01-03");
    const counts = countInBuckets(
      ["2026-01-01T10:00:00Z", "2026-01-01T23:00:00Z", "2026-01-02", null, undefined, "2026-01-03T00:00:00Z"],
      buckets
    );
    expect(counts).toEqual([2, 1, 1]);
  });

  it("returns all zeros when nothing falls in range", () => {
    const buckets = buildTimeBuckets("2026-01-01", "2026-01-03");
    expect(countInBuckets(["2025-12-25"], buckets)).toEqual([0, 0, 0]);
  });
});
