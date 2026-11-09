import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/components/OfflineQueueProvider", () => ({
  useOfflineQueue: () => ({ isOnline: true, enqueue: async () => {}, pending: 0 }),
}));
vi.mock("@/app/actions/siteMaterial", () => ({ createSiteMaterialDocAction: async () => ({ error: null }) }));

import { SiteMaterialForm } from "./SiteMaterialForm";

describe("SiteMaterialForm", () => {
  it("starts as two buttons: issue the Raw Material DC, and material returned", () => {
    const html = renderToStaticMarkup(<SiteMaterialForm serviceJobId="j" warehouses={[{ id: "w", name: "Main" }]} />);
    expect(html).toContain("Issue Material (Raw Material DC)");
    expect(html).toContain("Material Returned");
    expect(html).not.toContain("Vehicle No.");
  });
});
