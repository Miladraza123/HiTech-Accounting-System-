import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DcDoc } from "./DcDoc";

const base = {
  dcNo: "SMD-1",
  date: "10-November-2026",
  partyName: "Client",
  refNo: null,
  project: null,
  lines: [{ qty: 2, unit: "NOS", description: "Plate", remarks: null }],
  remarks: null,
  company: { name: "Co", phone: null, phone2: null, email: null, email2: null, address: null, ntn: null, strn: null },
  logoUrl: null,
  tagline: null,
  signatureUrl: null,
  stampUrl: null,
};

describe("DcDoc header", () => {
  it("the ordinary Delivery Challan header has no vehicle or driver fields", () => {
    const html = renderToStaticMarkup(<DcDoc {...base} />);
    expect(html).toContain("Ref/PO Number:");
    expect(html).not.toContain("Vehicle No.");
    expect(html).not.toContain("Driver Name");
  });
  it("the Raw Material DC prints Vehicle No. and Driver Name even when empty", () => {
    const html = renderToStaticMarkup(
      <DcDoc {...base} extraFields={[{ label: "Vehicle No.:", value: "" }, { label: "Driver Name:", value: "" }]} />
    );
    expect(html).toContain("Vehicle No.:");
    expect(html).toContain("Driver Name:");
    expect(html).toContain("Ref/PO Number:");
    expect(html).toContain("Project:");
  });
  it("shows the values when they are filled", () => {
    const html = renderToStaticMarkup(
      <DcDoc {...base} refNo="4500" project="Site work" extraFields={[{ label: "Vehicle No.:", value: "KHI-1" }, { label: "Driver Name:", value: "Ali" }]} />
    );
    for (const t of ["4500", "Site work", "KHI-1", "Ali"]) expect(html).toContain(t);
  });
});
