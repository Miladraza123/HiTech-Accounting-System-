import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/app/actions/deliveryChallans", () => ({ updateDcPrintDetailsAction: async () => ({ error: null }) }));

import { DcPrintDetailsEditor } from "./DcPrintDetailsEditor";

const base = { dcId: "d1", refNo: null, poNumber: "PO-1", project: null, projectSuggestions: [] };

describe("DcPrintDetailsEditor", () => {
  it("shows the edited print description in the summary, not the Sales Order text", () => {
    const html = renderToStaticMarkup(
      <DcPrintDetailsEditor {...base} canEdit lines={[{ sales_order_line_id: "l1", description: "Pipe 2in", print_description: "Pipe 2 inch GI", remarks: "ok" }]} />,
    );
    expect(html).toContain("Pipe 2 inch GI");
    expect(html).not.toContain("Pipe 2in");
  });
  it("falls back to the original description when none was edited", () => {
    const html = renderToStaticMarkup(
      <DcPrintDetailsEditor {...base} canEdit lines={[{ sales_order_line_id: "l1", description: "Pipe 2in", print_description: null, remarks: "ok" }]} />,
    );
    expect(html).toContain("Pipe 2in");
  });
});
