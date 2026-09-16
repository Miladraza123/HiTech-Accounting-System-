import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner } from "@/lib/auth";
import { TaskActionButtons } from "@/components/TaskActionButtons";
import { relatedEntityLink } from "@/lib/taskLinks";
import { buttonClass } from "@/components/ui/Button";
import { parsePage, pageRange, totalPages as computeTotalPages } from "@/lib/pagination";
import { PaginationControls } from "@/components/PaginationControls";

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

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ filter?: string; page?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { filter, page: pageParam } = await searchParams;
  const activeFilter: Filter = (["mine", "all", "overdue", "today", "upcoming", "done"] as const).includes(filter as Filter)
    ? (filter as Filter)
    : "mine";
  const page = parsePage(pageParam);
  const [rangeFrom, rangeTo] = pageRange(page);

  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  // The filter used to run in JS over every task in the table. It has to run
  // in SQL now — with pagination, filtering a single fetched page would
  // silently drop matches that live on other pages. `.lt`/`.gt` on due_date
  // also exclude NULLs by themselves, matching the old `!!r.due_date` guards.
  let query = supabase.from("tasks").select("*, profiles(full_name)", { count: "exact" });
  switch (activeFilter) {
    case "mine":
      query = query.eq("status", "Open").eq("assigned_to", user.id);
      break;
    case "all":
      query = query.eq("status", "Open");
      break;
    case "overdue":
      query = query.eq("status", "Open").lt("due_date", today);
      break;
    case "today":
      query = query.eq("status", "Open").eq("due_date", today);
      break;
    case "upcoming":
      query = query.eq("status", "Open").gt("due_date", today);
      break;
    case "done":
      query = query.neq("status", "Open");
      break;
  }

  // The two summary counts are whole-table figures, so they stay whole-table —
  // but as count-only queries (`head: true`), which return a number and no rows.
  const [{ data: tasks, count }, { data: profiles }, { count: myOpenCount }, { count: overdueCount }] = await Promise.all([
    query.order("due_date", { ascending: true, nullsFirst: false }).range(rangeFrom, rangeTo),
    supabase.from("profiles").select("id, full_name"),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("status", "Open").eq("assigned_to", user.id),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("status", "Open").lt("due_date", today),
  ]);
  const totalPages = computeTotalPages(count ?? 0);

  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  const filtered = (tasks ?? []).map((t) => ({
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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Tasks &amp; Follow-ups</h1>
          <p className="mt-1 text-sm text-ink-soft">All tasks for every order/job/client in one place — plus General tasks.</p>
        </div>
        <Link href="/tasks/new" className={buttonClass("primary", "sm")}>
          + New Task
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-2xl font-semibold text-ink tabular">{myOpenCount ?? 0}</p>
          <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">My Open Tasks</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className={`text-2xl font-semibold tabular ${(overdueCount ?? 0) > 0 ? "text-bad" : "text-ink"}`}>{overdueCount ?? 0}</p>
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
                    No tasks match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PaginationControls
        basePath="/tasks"
        searchParams={{ filter: activeFilter }}
        currentPage={page}
        totalPages={totalPages}
        totalCount={count ?? 0}
      />
    </div>
  );
}
