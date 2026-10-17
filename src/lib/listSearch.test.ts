import { describe, it, expect } from "vitest";
import { cleanSearchTerm, searchOr } from "./listSearch";

describe("cleanSearchTerm", () => {
  it("keeps document-number characters", () => {
    expect(cleanSearchTerm("  HTE/TFPL/5001 ")).toBe("HTE/TFPL/5001");
    expect(cleanSearchTerm("SRB 012")).toBe("SRB 012");
  });
  it("strips filter-structural and wildcard characters", () => {
    expect(cleanSearchTerm(String.raw`Ali, Khan (Sons) 100%_x\y*`)).toBe("Ali Khan Sons 100 x y");
    expect(cleanSearchTerm("a.b,c)")).toBe("a.b c");
  });
  it("handles empty / undefined / overlong input", () => {
    expect(cleanSearchTerm(undefined)).toBe("");
    expect(cleanSearchTerm("   ")).toBe("");
    expect(cleanSearchTerm("x".repeat(500)).length).toBe(80);
  });
});

describe("searchOr", () => {
  it("builds ilike clauses for each column", () => {
    expect(searchOr(["po_no", "ref"], "tri")).toBe("po_no.ilike.%tri%,ref.ilike.%tri%");
  });
  it("adds id lists only when they have ids", () => {
    expect(searchOr(["dc_no"], "x", [{ col: "party_id", ids: ["a", "b"] }, { col: "sales_order_id", ids: [] }])).toBe(
      "dc_no.ilike.%x%,party_id.in.(a,b)",
    );
  });
});
