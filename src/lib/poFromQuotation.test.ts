import { describe, it, expect } from "vitest";
import { asLineType, LINE_TYPE_LABELS } from "./lineType";
import { convertedLineIds, isLineOrdered, poPlan } from "./poFromQuotation";

describe("asLineType", () => {
  it("keeps the three types and reads anything else (old lines) as material", () => {
    expect(asLineType("fabrication")).toBe("fabrication");
    expect(asLineType("service")).toBe("service");
    expect(asLineType("material")).toBe("material");
    expect(asLineType(null)).toBe("material");
    expect(asLineType(undefined)).toBe("material");
    expect(asLineType("bogus")).toBe("material");
  });
  it("has a label for every type", () => {
    expect(Object.keys(LINE_TYPE_LABELS).sort()).toEqual(["fabrication", "material", "service"]);
  });
});

describe("poPlan", () => {
  it("counts only the chosen lines, per type", () => {
    expect(
      poPlan([
        { include: true, line_type: "material" },
        { include: true, line_type: "material" },
        { include: false, line_type: "fabrication" },
        { include: true, line_type: "service" },
      ])
    ).toEqual({ material: 2, fabrication: 0, service: 1 });
  });
  it("is empty when nothing is chosen", () => {
    expect(poPlan([{ include: false, line_type: "service" }])).toEqual({ material: 0, fabrication: 0, service: 0 });
  });
});

describe("convertedLineIds", () => {
  it("collects quotation lines already used by Sales Order lines and Service Job lines", () => {
    const ids = convertedLineIds(
      [{ quotation_line_id: "a" }, { quotation_line_id: null }],
      [{ quoted_lines: [{ quotation_line_id: "b" }, {}] }, { quoted_lines: null }, { quoted_lines: "x" }]
    );
    expect([...ids].sort()).toEqual(["a", "b"]);
  });
});

describe("isLineOrdered", () => {
  // Rev-2 line c continues Rev-1 line b, which continued Rev-0 line a.
  const sourceOf = new Map<string, string | null>([["a", null], ["b", "a"], ["c", "b"], ["d", null]]);
  it("follows the line back through every revision", () => {
    expect(isLineOrdered("c", sourceOf, new Set(["a"]))).toBe(true);
    expect(isLineOrdered("c", sourceOf, new Set(["b"]))).toBe(true);
    expect(isLineOrdered("b", sourceOf, new Set(["c"]))).toBe(false);
  });
  it("a new line, or one that continues an unordered line, is not ordered", () => {
    expect(isLineOrdered("d", sourceOf, new Set(["a"]))).toBe(false);
    expect(isLineOrdered("c", sourceOf, new Set())).toBe(false);
  });
  it("survives a loop in the data", () => {
    expect(isLineOrdered("x", new Map([["x", "y"], ["y", "x"]]), new Set())).toBe(false);
  });
});
