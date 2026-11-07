import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock("@/components/OfflineQueueProvider", () => ({
  useOfflineQueue: () => ({ isOnline: true, enqueue: async () => {}, pending: 0 }),
}));
vi.mock("@/app/actions/poFromQuotation", () => ({ createPoFromQuotationAction: async () => ({ error: null }) }));

import { NewPoFromQuotationForm, type PoSourceLine } from "./NewPoFromQuotationForm";
import { QuotationLineEditor, blankLine } from "./QuotationLineEditor";

const lines: PoSourceLine[] = [
  { id: "1", item_id: null, description: "Pump seal kit", qty: 4, unit: "NOS", rate: 1000, tax_pct: 18, line_type: "material", alreadyDone: false },
  { id: "2", item_id: null, description: "Fabricate base frame", qty: 1, unit: "NOS", rate: 50000, tax_pct: 18, line_type: "fabrication", alreadyDone: false },
  { id: "3", item_id: null, description: "Repair vent grilles", qty: 1, unit: "LOT", rate: 9000, tax_pct: 18, line_type: "service", alreadyDone: false },
  { id: "4", item_id: null, description: "Old line", qty: 1, unit: "NOS", rate: 10, tax_pct: 18, line_type: null, alreadyDone: true },
];

describe("NewPoFromQuotationForm", () => {
  it("shows each line with its type and the documents the PO will create", () => {
    const html = renderToStaticMarkup(<NewPoFromQuotationForm quotationId="q" lines={lines} defaultPaymentTerms={null} />);
    expect(html).toContain("Pump seal kit");
    expect(html).toContain("Material Supply Sales Order: 1 line(s)");
    expect(html).toContain("Fabrication Sales Order: 1 line(s)");
    expect(html).toContain("Service Job: 1 line(s)");
  });
  it("leaves lines from an earlier PO unticked and says so", () => {
    const html = renderToStaticMarkup(<NewPoFromQuotationForm quotationId="q" lines={lines} defaultPaymentTerms={null} />);
    expect(html).toContain("Already in an earlier PO for this quotation");
    expect(html).not.toContain("Material Supply Sales Order: 2 line(s)");
  });
});

describe("QuotationLineEditor Type column", () => {
  const props = { items: [], units: [], lines: [blankLine(18, "k1")], onChange: () => {}, onItemPicked: () => {} };
  it("appears only for quotations (showType)", () => {
    expect(renderToStaticMarkup(<QuotationLineEditor {...props} showType />)).toContain('aria-label="Line type"');
    expect(renderToStaticMarkup(<QuotationLineEditor {...props} />)).not.toContain('aria-label="Line type"');
  });
});
