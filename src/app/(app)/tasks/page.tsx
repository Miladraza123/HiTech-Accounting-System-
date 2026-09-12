import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner } from "@/lib/auth";
import { TaskActionButtons } from "@/components/TaskActionButtons";
import { relatedEntityLink } from "@/lib/taskLinks";
import { buttonClass } from "@/components/ui/Button";

type Filter = "mine" | "all" | "overdue" | "today" | "upcoming" | "done";

const FILTER_LABEL: Record<Filter, string> = {
  mine: "My Tasks",
  all: "All Open",
  overdue: "Overdue",
  today: "Due Today",
  upcoming: "Upcoming",
  done: "Completed / Cancelled",
};

const STATUS_STYLE: Record<string, string> = {
  Open: "bg-ledger-soft text-ledger",
  Done: "bg-good-soft text-good",
  Cancelled: "bg-surface-2 text-ink-faint",
};

const PRIORITY_STYLE: Record<string, string> = {
  Low: "text-ink-faint",
  Medium: "text-ink-soft",
  High: "text-bad font-medium",
};

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { filter } = await searchParams;
  const activeFilter: Filter = (["mine", "all", "overdue", "today", "upcoming", "done"] as const).includes(filter as Filter)
    ? (filter as Filter)
    : "mine";

  const supabase = await createClient();
  const [{ data: tasks }, { data: profiles }] = await Promise.all([
    supabase.from("tasks").select("*, profiles(full_name)").order("due_date", { ascending: true, nullsFirst: false }),
    supabase.from("profiles").select("id, full_name"),
  ]);

  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const today = new Date().toISOString().slice(0, 10);

  const rows = (tasks ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    due_date: t.due_date,
    assigned_to: t.assigned_to,
    created_by: t.created_by,
    assignee_name: (t.profiles as unknown as { full_name: string } | null)?.full_name ?? "—",
    creator_name: t.created_by ? nameById.get(t.created_by) ?? "—" : "—",
    link: relatedEntityLink(t.related_table, t.related_id),
    isOverdue: t.status === "Open" && !!t.due_date && t.due_date < today,
    isDueToday: t.status === "Open" && t.due_date === today,
  }));

  const filtered = rows.filter((r) => {
    switch (activeFilter) {
      case "mine":
        return r.status === "Open" && r.assigned_to === user.id;
      case "all":
        return r.status === "Open";
      case "overdue":
        return r.isOverdue;
      case "today":
        return r.isDueToday;
      case "upcoming":
        return r.status === "Open" && !!r.due_date && r.due_date > today;
      case "done":
        return r.status !== "Open";
    }
  });

  const overdueCount = rows.filter((r) => r.isOverdue).length;
  const myOpenCount = rows.filter((r) => r.status === "Open" && r.assigned_to === user.id).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Tasks &amp; Follow-ups</h1>
          <p className="mt-1 text-sm text-ink-soft">Har order/job/client ke tasks ek jaga — plus General tasks.</p>
        </div>
        <Link href="/tasks/new" className={buttonClass("primary", "sm")}>
          + New Task
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-2xl font-semibold text-ink tabular">{myOpenCount}</p>
          <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">My Open Tasks</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className={`text-2xl font-semibold tabular ${overdueCount > 0 ? "text-bad" : "text-ink"}`}>{overdueCount}</p>
          <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Overdue (All Users)</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 rounded-md border border-line bg-bg p-1 w-fit">
        {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
          <Link
            key={f}
            href={`/tasks?filter=${f}`}
            className={`rounded px-3 py-1.5 text-xs font-medium transition ${
              activeFilter === f ? "bg-accent text-white" : "text-ink-soft hover:bg-surface-2"
            }`}
          >
            {FILTER_LABEL[f]}
          </Link>
        ))}
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-3 py-2">Title</th>
                <th className="text-left px-3 py-2">Linked To</th>
                <th className="text-left px-3 py-2">Assigned To</th>
                <th className="text-left px-3 py-2">Priority</th>
                <th className="text-left px-3 py-2">Due Date</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-right px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const canAct = isOwner(user) || user.id === t.assigned_to || user.id === t.created_by;
                const canCancel = isOwner(user) || user.id === t.created_by;
                return (
                  <tr key={t.id} className="border-t border-line">
                    <td className="px-3 py-2 text-ink">
                      <Link href={`/tasks/${t.id}`} className="hover:underline underline-offset-2">
                        {t.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {t.link ? (
                        <Link href={t.link.href} className="text-accent-ink underline underline-offset-2">
                          {t.link.label}
                        </Link>
                      ) : (
                        <span className="text-ink-faint">General</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-ink-soft">{t.assignee_name}</td>
                    <td className={`px-3 py-2 ${PRIORITY_STYLE[t.priority] ?? ""}`}>{t.priority}</td>
                    <td className={`px-3 py-2 tabular text-xs ${t.isOverdue ? "text-bad font-medium" : "text-ink-faint"}`}>{t.due_date ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[t.status] ?? ""}`}>{t.status}</span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end">
                        <TaskActionButtons taskId={t.id} status={t.status} canAct={canAct} canCancel={canCancel} revalidateTo="/tasks" />
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!filtered.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-ink-faint">
                    Is filter mein koi task nahi hai.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
