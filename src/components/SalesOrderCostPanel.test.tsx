import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SalesOrderCostPanel } from "./SalesOrderCostPanel";
import { parseEstimatedCost } from "./EstimatedCostField";

const base = { sales_subtotal: 2000, estimated_cost: 1300, po_cost: 500, po_count: 1, job_cost: 200, actual_cost: 700, estimated_profit: 700, actual_profit: 1300 };

describe("SalesOrderCostPanel", () => {
  it("shows selling value, estimate, actual cost and both profits with margin", () => {
    const html = renderToStaticMarkup(<SalesOrderCostPanel salesOrderId="so1" summary={base} canEdit />);
    expect(html).toContain("Cost &amp; Profit");
    expect(html).toContain("2,000.00");
    expect(html).toContain("700.00");
    expect(html).toContain("(35%)");
    expect(html).toContain("(65%)");
    expect(html).toContain("1 linked");
    expect(html).toContain("Save estimate");
  });
  it("says 'not set' with no estimate, and a loss is flagged in the bad colour", () => {
    const html = renderToStaticMarkup(<SalesOrderCostPanel salesOrderId="so1" summary={{ ...base, estimated_cost: null, estimated_profit: null, actual_profit: -150 }} canEdit={false} />);
    expect(html).toContain("not set");
    expect(html).toContain("text-bad");
    expect(html).not.toContain("Save estimate");
  });
});

describe("parseEstimatedCost", () => {
  it("empty is 'not set', numbers pass, junk and negatives are refused", () => {
    expect(parseEstimatedCost("")).toBeNull();
    expect(parseEstimatedCost("  ")).toBeNull();
    expect(parseEstimatedCost("1200.5")).toBe(1200.5);
    expect(parseEstimatedCost("0")).toBe(0);
    expect(parseEstimatedCost("-5")).toBeUndefined();
    expect(parseEstimatedCost("abc")).toBeUndefined();
  });
});
