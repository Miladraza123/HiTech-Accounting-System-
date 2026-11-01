import { describe, it, expect } from "vitest";
import { isPurchaseOrderEditable, serializeEditedLines, parseSnapshot } from "./poEdit";
import { blankLine } from "@/components/QuotationLineEditor";

describe("isPurchaseOrderEditable", () => {
  it("allows open POs only", () => {
    expect(isPurchaseOrderEditable("Confirmed")).toBe(true);
    expect(isPurchaseOrderEditable("PartiallyReceived")).toBe(true);
    for (const s of ["Received", "Closed", "Cancelled"]) expect(isPurchaseOrderEditable(s)).toBe(false);
  });
});

describe("serializeEditedLines", () => {
  const dbId = "718f2cdc-3cb1-4d48-a8f4-85436954ba92";
  it("keeps the database id of existing rows and omits it for new rows", () => {
    const existing = { ...blankLine(0, dbId), description: "Pipe", qty: "12", rate: "100", tax_pct: "18", item_id: "i1", unit: "PCS" };
    const added = { ...blankLine(0, "l7"), description: "Gasket", qty: "4", rate: "50", tax_pct: "0" };
    const out = serializeEditedLines([existing, added]);
    expect(out[0]).toMatchObject({ id: dbId, description: "Pipe", ordered_qty: 12, rate: 100, tax_pct: 18, item_id: "i1", unit: "PCS" });
    expect(out[1]).not.toHaveProperty("id");
    expect(out[1]).toMatchObject({ description: "Gasket", ordered_qty: 4, rate: 50 });
  });
  it("drops blank rows", () => {
    expect(serializeEditedLines([blankLine(0, "l1")])).toEqual([]);
  });
});

describe("parseSnapshot", () => {
  it("accepts the stored shape and rejects junk", () => {
    expect(parseSnapshot({ header: { po_no: "PO-1" }, lines: [] })).not.toBeNull();
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot({ header: {}, lines: "x" })).toBeNull();
    expect(parseSnapshot("text")).toBeNull();
  });
});
