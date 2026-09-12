import { describe, expect, it } from "vitest";
import { diffFields } from "./smartMerge";

describe("diffFields", () => {
  it("returns only the fields that actually changed", () => {
    const base = { credit_limit: 500000, credit_days: 30 };
    const next = { credit_limit: 600000, credit_days: 30 };
    expect(diffFields(base, next)).toEqual({ credit_limit: 600000 });
  });

  it("returns an empty object when nothing changed", () => {
    const base = { legal_name: "Al-Noor", phone: "0300" };
    const next = { legal_name: "Al-Noor", phone: "0300" };
    expect(diffFields(base, next)).toEqual({});
  });

  it("tolerates numeric-vs-string-vs-formatted-numeric equivalence", () => {
    const base = { default_sales_tax_pct: "18.00" };
    const next = { default_sales_tax_pct: 18 };
    expect(diffFields(base, next)).toEqual({});
  });

  it("treats null, undefined and empty string as equivalent (unset)", () => {
    const base = { address: null };
    const next = { address: "" };
    expect(diffFields(base, next)).toEqual({});
  });

  it("detects a real change from unset to a real value", () => {
    const base = { address: null };
    const next = { address: "123 Main St" };
    expect(diffFields(base, next)).toEqual({ address: "123 Main St" });
  });

  it("detects multiple independent field changes", () => {
    const base = { a: 1, b: "x", c: true };
    const next = { a: 2, b: "x", c: false };
    expect(diffFields(base, next)).toEqual({ a: 2, c: false });
  });
});
