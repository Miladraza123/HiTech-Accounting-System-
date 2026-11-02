import { describe, it, expect } from "vitest";
import { marginPct, parseCostSummary } from "./orderCost";

describe("marginPct", () => {
  it("is profit over selling value, to one decimal", () => {
    expect(marginPct(700, 2000)).toBe(35);
    expect(marginPct(-100, 800)).toBe(-12.5);
  });
  it("is null when there is no profit figure or nothing to divide by", () => {
    expect(marginPct(null, 2000)).toBeNull();
    expect(marginPct(500, 0)).toBeNull();
  });
});

describe("parseCostSummary", () => {
  it("reads the function's jsonb, keeping an unset estimate as null", () => {
    const s = parseCostSummary({ sales_subtotal: "2000.00", estimated_cost: null, po_cost: 500, po_count: 1, job_cost: "200.00", actual_cost: 700, estimated_profit: null, actual_profit: 1300 });
    expect(s).toEqual({ sales_subtotal: 2000, estimated_cost: null, po_cost: 500, po_count: 1, job_cost: 200, actual_cost: 700, estimated_profit: null, actual_profit: 1300 });
  });
  it("rejects junk", () => {
    expect(parseCostSummary(null)).toBeNull();
    expect(parseCostSummary("x")).toBeNull();
    expect(parseCostSummary({ nothing: 1 })).toBeNull();
  });
});
