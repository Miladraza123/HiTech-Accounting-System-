import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/app/actions/hr", () => ({ setFixedChargesAction: async () => ({ error: null }), setLineChargesAction: async () => ({ error: null }), reloadLineChargesAction: async () => ({ error: null }) }));

import { FixedChargesEditor } from "./FixedChargesEditor";
import { SalaryLineCharges } from "./SalaryLineCharges";

describe("FixedChargesEditor", () => {
  const initial = [
    { id: "a", name: "Lunch", amount: 3000, is_active: true },
    { id: "b", name: "Uniform", amount: 500, is_active: false },
  ];
  it("lists every charge and totals only the active ones", () => {
    const html = renderToStaticMarkup(<FixedChargesEditor employeeId="e1" initial={initial} canEdit />);
    expect(html).toContain('value="Lunch"');
    expect(html).toContain('value="Uniform"');
    expect(html).toContain("Rs 3,000");
    expect(html).toContain("Save charges");
  });
  it("is read-only without edit rights", () => {
    const html = renderToStaticMarkup(<FixedChargesEditor employeeId="e1" initial={initial} canEdit={false} />);
    expect(html).not.toContain("Save charges");
    expect(html).not.toContain("Add charge");
  });
  it("shows an empty hint when nothing is set", () => {
    expect(renderToStaticMarkup(<FixedChargesEditor employeeId="e1" initial={[]} canEdit />)).toContain("No fixed charges set.");
  });
});

describe("SalaryLineCharges", () => {
  it("starts as a small link on the sheet line", () => {
    const html = renderToStaticMarkup(<SalaryLineCharges sheetId="s" lineId="l" charges={[]} />);
    expect(html).toContain("Fixed charges");
    expect(html).not.toContain("Save");
  });
});
