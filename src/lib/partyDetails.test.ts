import { describe, it, expect } from "vitest";
import { isPlausibleEmail, normalizePartyDetails, toFormDetails } from "./partyDetails";

describe("normalizePartyDetails", () => {
  it("trims, and turns blank optional fields into null while the name stays", () => {
    expect(normalizePartyDetails({ legal_name: "  TRI-PACK  ", ntn: " 0984495-3 ", strn: "  ", cnic: "", billing_address: " Plot G1\nPort Qasim ", province: "" })).toEqual({
      legal_name: "TRI-PACK",
      ntn: "0984495-3",
      strn: null,
      cnic: null,
      billing_address: "Plot G1\nPort Qasim",
      province: null,
    });
  });
  it("round-trips stored nulls through the form", () => {
    const stored = { legal_name: "A", ntn: null, strn: "12", cnic: null, billing_address: null, province: "SD" };
    const form = toFormDetails(stored);
    expect(form).toEqual({ legal_name: "A", ntn: "", strn: "12", cnic: "", billing_address: "", province: "SD" });
    expect(normalizePartyDetails(form)).toEqual(stored);
  });
});

describe("isPlausibleEmail", () => {
  it("accepts empty and normal addresses, refuses junk", () => {
    expect(isPlausibleEmail("")).toBe(true);
    expect(isPlausibleEmail("  ")).toBe(true);
    expect(isPlausibleEmail("wajih@qict.com.pk")).toBe(true);
    for (const bad of ["wajih", "wajih@", "@qict.com", "a b@c.com", "a@b"]) expect(isPlausibleEmail(bad)).toBe(false);
  });
});
