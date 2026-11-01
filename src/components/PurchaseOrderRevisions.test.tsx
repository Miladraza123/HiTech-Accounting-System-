import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PurchaseOrderRevisions, type PoRevisionRow } from "./PurchaseOrderRevisions";

const snapshot = {
  header: { po_no: "PO-1", supplier_name: "FAA Steel", warehouse_name: "Main", expected_delivery: "2026-12-01", status: "Confirmed", subtotal: 2000, tax_total: 180, grand_total: 2180 },
  lines: [{ id: "l1", description: "Pipe", ordered_qty: 10, unit: "PCS", rate: 100, tax_pct: 18, amount: 1000, received_qty: 0 }],
};
const rows: PoRevisionRow[] = [
  { id: "a", rev_no: 0, summary: 'Line "Pipe": qty 10 -> 12; Total: 2180 -> 2616', reason: "Client increased qty", changed_at: "2026-11-01T10:00:00Z", changed_by_name: "Muhammad Abbas", snapshot },
  { id: "b", rev_no: 1, summary: 'Removed line "Gasket"', reason: null, changed_at: "2026-11-02T10:00:00Z", changed_by_name: "Shaideer", snapshot: { not: "a snapshot" } },
];

describe("PurchaseOrderRevisions", () => {
  it("renders nothing for a PO that was never edited", () => {
    expect(renderToStaticMarkup(<PurchaseOrderRevisions currentRevision={0} revisions={[]} />)).toBe("");
  });
  it("lists newest first with who, when, what and why", () => {
    const html = renderToStaticMarkup(<PurchaseOrderRevisions currentRevision={2} revisions={rows} />);
    expect(html.indexOf("Revision 2")).toBeLessThan(html.indexOf("Revision 1"));
    expect(html).toContain("Muhammad Abbas");
    expect(html).toContain("Shaideer");
    expect(html).toContain("qty 10 -&gt; 12");
    expect(html).toContain("Reason: Client increased qty");
    expect(html).toContain("Current version");
  });
  it("shows the replaced version's lines and total, and tolerates a malformed snapshot", () => {
    const html = renderToStaticMarkup(<PurchaseOrderRevisions currentRevision={2} revisions={rows} />);
    expect(html).toContain("View Revision 0 (before this change)");
    expect(html).toContain("FAA Steel");
    expect(html).toContain("Total: 2180");
    expect(html).not.toContain("View Revision 1 (before this change)");
  });
});
