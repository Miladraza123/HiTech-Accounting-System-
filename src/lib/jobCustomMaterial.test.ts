import { describe, it, expect } from "vitest";
import { serializeCustomMaterials } from "./jobCustomMaterial";

const row = (name: string, qty = "1", unit = "") => ({ key: name || "k", name, qty, unit });

describe("serializeCustomMaterials", () => {
  it("turns named rows into lines and skips empty rows", () => {
    expect(serializeCustomMaterials([row("PVC Sheet 8x4", "13", "NOS"), row(""), row("  Table  ", "8", "")])).toEqual({
      lines: [
        { name: "PVC Sheet 8x4", required_qty: 13, unit: "NOS" },
        { name: "Table", required_qty: 8 },
      ],
      error: null,
    });
  });
  it("asks for a quantity above zero for a named row", () => {
    expect(serializeCustomMaterials([row("Paint", "0")]).error).toContain("Paint");
    expect(serializeCustomMaterials([row("Paint", "")]).error).toContain("Paint");
    expect(serializeCustomMaterials([row("Paint", "abc")]).error).toContain("Paint");
  });
  it("is empty when nothing is typed", () => {
    expect(serializeCustomMaterials([row("")])).toEqual({ lines: [], error: null });
  });
});
