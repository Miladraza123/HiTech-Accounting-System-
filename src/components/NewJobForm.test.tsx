import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock("@/components/OfflineQueueProvider", () => ({
  useOfflineQueue: () => ({ isOnline: true, enqueue: async () => {}, pending: 0 }),
}));
vi.mock("@/app/actions/jobs", () => ({ createJobAction: async () => ({ error: null }) }));

import { NewJobForm } from "./NewJobForm";

describe("NewJobForm", () => {
  it("has a Custom material section for items that are not in the Items list", () => {
    const html = renderToStaticMarkup(
      <NewJobForm soLines={[]} warehouses={[]} templates={[]} items={[]} units={[]} profiles={[]} />
    );
    expect(html).toContain("Custom material (not in stock)");
    expect(html).toContain("+ Add custom material");
    expect(html).toContain("Create Job");
  });
});
