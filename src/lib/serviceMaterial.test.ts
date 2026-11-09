import { describe, it, expect } from "vitest";
import { costHeading, summarizeMaterial } from "./serviceMaterial";

const doc = (kind: string, status: string, lines: { item_id: string; qty: number; description: string }[]) => ({
  kind,
  status,
  service_material_lines: lines,
});

describe("summarizeMaterial", () => {
  const docs = [
    doc("issue", "Issued", [{ item_id: "a", qty: 10, description: "Plate" }, { item_id: "b", qty: 2, description: "Bolt" }]),
    doc("issue", "Issued", [{ item_id: "a", qty: 5, description: "Plate" }]),
    doc("return", "Issued", [{ item_id: "a", qty: 3, description: "Plate" }]),
    doc("issue", "Cancelled", [{ item_id: "b", qty: 99, description: "Bolt" }]),
  ];
  const ledger = [
    { item_id: "a", amount: 1000 },
    { item_id: "a", amount: 500 },
    { item_id: "a", amount: -300 },
    { item_id: "b", amount: 200 },
    { item_id: "b", amount: 9900 }, // cancelled issue ...
    { item_id: "b", amount: -9900 }, // ... and its reversal
  ];

  it("adds issued and returned quantities, ignoring cancelled documents", () => {
    const { rows } = summarizeMaterial(docs, ledger);
    const a = rows.find((r) => r.item_id === "a")!;
    expect([a.issued, a.returned, a.net]).toEqual([15, 3, 12]);
    expect(rows.find((r) => r.item_id === "b")!.issued).toBe(2);
  });
  it("sums cost from the ledger (reversals cancel out) and totals it", () => {
    const { rows, totalCost, netQty } = summarizeMaterial(docs, ledger);
    expect(rows.find((r) => r.item_id === "a")!.cost).toBe(1200);
    expect(rows.find((r) => r.item_id === "b")!.cost).toBe(200);
    expect(totalCost).toBe(1400);
    expect(netQty).toBe(14);
  });
  it("hides cost when the ledger is not visible to the user", () => {
    const { rows, totalCost } = summarizeMaterial(docs, null);
    expect(rows.every((r) => r.cost === null)).toBe(true);
    expect(totalCost).toBeNull();
  });
  it("is empty for a job with no material", () => {
    expect(summarizeMaterial([], [])).toEqual({ rows: [], netQty: 0, totalCost: 0 });
  });
});

describe("costHeading", () => {
  it("shows the final total once delivered", () => {
    expect(costHeading("Delivered")).toBe("Total Cost (final)");
    expect(costHeading("Received")).toContain("so far");
    expect(costHeading("Completed")).toContain("so far");
    expect(costHeading("Cancelled")).toContain("cancelled");
  });
});
