import { describe, it, expect } from "vitest";
import { agingBucket, dueDateFrom, emptyBuckets, bucketTotal } from "./aging";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

describe("agingBucket", () => {
  it("buckets a due date today (or in the future) as current", () => {
    expect(agingBucket(daysAgo(0))).toBe("current");
    expect(agingBucket(daysAgo(-5))).toBe("current"); // due date in the future
  });

  it("buckets 1-30 days overdue correctly, boundaries inclusive", () => {
    expect(agingBucket(daysAgo(1))).toBe("d1_30");
    expect(agingBucket(daysAgo(30))).toBe("d1_30");
  });

  it("buckets 31-60 days overdue correctly, boundaries inclusive", () => {
    expect(agingBucket(daysAgo(31))).toBe("d31_60");
    expect(agingBucket(daysAgo(60))).toBe("d31_60");
  });

  it("buckets 61-90 days overdue correctly, boundaries inclusive", () => {
    expect(agingBucket(daysAgo(61))).toBe("d61_90");
    expect(agingBucket(daysAgo(90))).toBe("d61_90");
  });

  it("buckets anything past 90 days as d90_plus", () => {
    expect(agingBucket(daysAgo(91))).toBe("d90_plus");
    expect(agingBucket(daysAgo(400))).toBe("d90_plus");
  });
});

describe("dueDateFrom", () => {
  it("adds credit_days to the document date", () => {
    expect(dueDateFrom("2026-01-01", 30)).toBe("2026-01-31");
  });

  it("treats 0/undefined credit_days as due on the document date itself", () => {
    expect(dueDateFrom("2026-01-01", 0)).toBe("2026-01-01");
  });

  it("rolls over month/year boundaries correctly", () => {
    expect(dueDateFrom("2026-12-15", 30)).toBe("2027-01-14");
  });
});

describe("emptyBuckets / bucketTotal", () => {
  it("starts every bucket at zero", () => {
    const b = emptyBuckets();
    expect(bucketTotal(b)).toBe(0);
    expect(b).toEqual({ current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 });
  });

  it("sums all five buckets", () => {
    const b = { current: 100, d1_30: 200, d31_60: 300, d61_90: 400, d90_plus: 500 };
    expect(bucketTotal(b)).toBe(1500);
  });
});
