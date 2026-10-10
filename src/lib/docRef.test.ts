import { describe, expect, it } from "vitest";
import { formatAmount, formatInvoiceDate, formatQuoteDate, isValidShortCode, normalizeShortCode, quotationRef, serialOf, validityDays } from "./docRef";

describe("docRef", () => {
  it("builds the quotation reference from the codes and the running serial", () => {
    expect(quotationRef("HTE", "TPFL", "QTN-202627-0012")).toBe("HTE/TPFL/12");
    expect(quotationRef("HTE", "TPFL", "QTN-202627-5410")).toBe("HTE/TPFL/5410");
  });
  it("falls back to the quotation number until both codes exist", () => {
    expect(quotationRef("HTE", null, "QTN-202627-0001")).toBe("QTN-202627-0001");
    expect(quotationRef(null, "TPFL", "QTN-202627-0001")).toBe("QTN-202627-0001");
    expect(quotationRef("HTE", "TPFL", "ODD")).toBe("ODD");
  });
  it("reads the serial", () => {
    expect(serialOf("SRB 007")).toBe(7);
    expect(serialOf("QTN-202627-0100")).toBe(100);
    expect(serialOf("none")).toBeNull();
  });
  it("validates short codes", () => {
    expect(normalizeShortCode(" tpfl ")).toBe("TPFL");
    expect(isValidShortCode("TPFL")).toBe(true);
    expect(isValidShortCode("A")).toBe(false);
    expect(isValidShortCode("TP-FL")).toBe(false);
    expect(isValidShortCode("ABCDEFGHIJK")).toBe(false);
  });
  it("formats amounts and dates like the printed documents", () => {
    expect(formatAmount(4800)).toBe("4,800");
    expect(formatAmount("19200.00")).toBe("19,200");
    expect(formatAmount(3456.5)).toBe("3,456.50");
    expect(formatQuoteDate("2026-10-06")).toBe("6-Oct-26");
    expect(formatInvoiceDate("2026-10-06")).toBe("6/10/2026");
  });
  it("counts validity in days", () => {
    expect(validityDays("2026-10-06T08:00:00Z", "2026-10-13")).toBe(7);
    expect(validityDays("2026-10-06T08:00:00Z", "2026-10-01")).toBe(0);
    expect(validityDays("2026-10-06T08:00:00Z", null)).toBeNull();
  });
});
