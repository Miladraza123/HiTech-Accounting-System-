import { describe, it, expect } from "vitest";
import { asLineType, LINE_TYPE_LABELS } from "./lineType";
import { convertedLineIds, poPlan } from "./poFromQuotation";

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
