import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/app/actions/tasks", () => ({
  acceptTaskAction: async () => ({ error: null }),
  completeTaskAction: async () => ({ error: null }),
  reopenTaskAction: async () => ({ error: null }),
  cancelTaskAction: async () => ({ error: null }),
  deleteTaskAction: async () => ({ error: null }),
}));

const tasks = [
  { id: "t1", title: "Pay electric bill", priority: "High", status: "Open", due_date: "2026-11-01", due_time: "09:00:00", recurring_task_id: "r1" },
  { id: "t2", title: "Check stock", priority: "Medium", status: "Open", due_date: "2026-11-09", due_time: "09:00:00", recurring_task_id: "r2" },
  { id: "t3", title: "Weekly report", priority: "Low", status: "Open", due_date: "2026-11-09", due_time: "23:59:00", recurring_task_id: null },
];
let data: typeof tasks = tasks;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async () => ({ data: 0, error: null }),
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "lte", "order"]) q[m] = () => q;
      q.limit = async () => ({ data, error: null });
      return q;
    },
  }),
}));
vi.mock("@/lib/recurringTasks", async (orig) => {
  const real = await orig<typeof import("@/lib/recurringTasks")>();
  return { ...real, karachiNow: () => ({ date: "2026-11-09", time: "10:00" }) };
});

import { TodaysTasks } from "./TodaysTasks";

const user = { id: "u1", fullName: "Test", roles: ["sales"] } as never;

describe("TodaysTasks", () => {
  it("lists late tasks as Overdue and today's tasks whose time has come as Due now", async () => {
    data = tasks;
    const html = renderToStaticMarkup(await TodaysTasks({ user, revalidateTo: "/tasks" }));
    expect(html).toContain("Today&#x27;s Tasks");
    expect(html).toContain("Overdue (1)");
    expect(html).toContain("Pay electric bill");
    expect(html).toContain("Due now");
    expect(html).toContain("9:00 AM");
    // 11:59 PM has not come yet at 10:00
    expect(html.match(/Due now/g)?.length).toBe(1);
  });
  it("shows nothing when nothing is due", async () => {
    data = [];
    const html = renderToStaticMarkup(await TodaysTasks({ user, revalidateTo: "/tasks" }));
    expect(html).not.toContain("Today&#x27;s Tasks");
  });
});
