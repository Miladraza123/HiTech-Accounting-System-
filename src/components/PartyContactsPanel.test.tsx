import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/app/actions/parties", () => ({ savePartyContactAction: async () => ({ error: null }), deletePartyContactAction: async () => ({ error: null }) }));

import { PartyContactsPanel } from "./PartyContactsPanel";

const contacts = [
  { id: "1", name: "MUHAMMAD WAJIH", designation: "Manager", phone: "+92 21 34739100", email: "wajih@qict.com", is_primary: true },
  { id: "2", name: "Sana Ali", designation: null, phone: null, email: null, is_primary: false },
];

describe("PartyContactsPanel", () => {
  it("lists contacts with the primary one marked", () => {
    const html = renderToStaticMarkup(<PartyContactsPanel partyId="p" contacts={contacts} canEdit canDelete />);
    expect(html).toContain("MUHAMMAD WAJIH");
    expect(html).toContain("Manager");
    expect(html).toContain("+92 21 34739100");
    expect(html).toContain("Primary");
    expect(html).toContain("Sana Ali");
    expect(html).toContain("+ Add contact");
    expect(html).toContain("Edit");
    expect(html).toContain("Remove");
  });
  it("hides Remove without delete rights and every edit control when read-only", () => {
    const noDelete = renderToStaticMarkup(<PartyContactsPanel partyId="p" contacts={contacts} canEdit canDelete={false} />);
    expect(noDelete).toContain("Edit");
    expect(noDelete).not.toContain("Remove");
    const readOnly = renderToStaticMarkup(<PartyContactsPanel partyId="p" contacts={contacts} canEdit={false} canDelete={false} />);
    expect(readOnly).not.toContain("+ Add contact");
    expect(readOnly).not.toContain("Edit");
  });
  it("says so when there is no contact", () => {
    expect(renderToStaticMarkup(<PartyContactsPanel partyId="p" contacts={[]} canEdit canDelete={false} />)).toContain("No contact yet.");
  });
});
