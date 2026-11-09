import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/components/OfflineQueueProvider", () => ({
  useOfflineQueue: () => ({ isOnline: true, enqueue: async () => {}, pending: 0 }),
}));
vi.mock("@/app/actions/serviceJobs", () => ({ createServiceMaterialDocAction: async () => ({ error: null }) }));

import { ServiceMaterialForm } from "./ServiceMaterialForm";

describe("ServiceMaterialForm", () => {
  it("starts as two buttons: issue to site, and material returned", () => {
    const html = renderToStaticMarkup(<ServiceMaterialForm serviceJobId="j" warehouses={[{ id: "w", name: "Main" }]} />);
    expect(html).toContain("Issue Material (Site DC)");
    expect(html).toContain("Material Returned");
    expect(html).not.toContain("Vehicle No.");
  });
});
