import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isOwner, type CurrentUser } from "@/lib/auth";
import { karachiNow, formatTime, isDueNow } from "@/lib/recurringTasks";
import { TaskActionButtons } from "@/components/TaskActionButtons";
import { AutoRefresh } from "@/components/AutoRefresh";

const PRIORITY_STYLE: Record<string, string> = { Low: "text-ink-faint", Medium: "text-ink-soft", High: "text-bad font-medium" };

/**
 * Today's Tasks: the signed-in user's open tasks that are due today or already late, on top of the dashboard.
 * It also makes today's tasks from the user's Recurring Tasks first (idempotent), so the list is complete.
 * Shows nothing when there is nothing due.
 */
export async function TodaysTasks({ user, revalidateTo }: { user: CurrentUser; revalidateTo: string }) {
  const supabase = await createClient();
  try {
    await supabase.rpc("fn_generate_recurring_tasks");
  } catch {
    // never let a reminder problem break the page
  }
  const { date: today, time: now } = karachiNow();
  const { data } = await supabase
    .from("tasks")
    .select("id, title, priority, status, due_date, due_time, recurring_task_id")
    .eq("assigned_to", user.id)
    .in("status", ["Open", "Accepted"])
    .lte("due_date", today)
    .order("due_date", { ascending: true })
    .order("due_time", { ascending: true, nullsFirst: false })
    .limit(30);
  const tasks = data ?? [];
  if (!tasks.length) return <AutoRefresh />;

  const overdue = tasks.filter((t) => (t.due_date ?? today) < today);
  const todays = tasks.filter((t) => t.due_date === today);

  const row = (t: (typeof tasks)[number]) => {
    const late = (t.due_date ?? today) < today;
    const dueNow = isDueNow(t, today, now);
    return (
      <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2 first:border-t-0">
        <div className="min-w-0">
          <Link href={`/tasks/${t.id}`} className="text-sm text-ink hover:underline underline-offset-2">
            {t.title}
          </Link>
          <p className="text-xs text-ink-faint">
            {late ? `Was due ${t.due_date}` : "Today"}
            {t.due_time && ` · ${formatTime(t.due_time)}`}
            {t.recurring_task_id && " · Recurring"} · <span className={PRIORITY_STYLE[t.priority] ?? ""}>{t.priority}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {late ? (
            <span className="rounded-full bg-bad-soft px-2 py-0.5 text-[11px] font-mono text-bad">Overdue</span>
          ) : dueNow ? (
            <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-mono text-warn">Due now</span>
          ) : null}
          <TaskActionButtons taskId={t.id} status={t.status} canAccept canAct canCancel={isOwner(user)} revalidateTo={revalidateTo} />
        </div>
      </li>
    );
  };

  return (
    <section className="rounded-xl border border-line bg-surface p-4 space-y-3" aria-label="Today's Tasks">
      <AutoRefresh />
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">Today&apos;s Tasks</h2>
        <Link href="/tasks/recurring" className="text-xs text-accent-ink underline underline-offset-2">
          Recurring Tasks
        </Link>
      </div>
      {overdue.length > 0 && (
        <div>
          <p className="text-[11px] font-mono uppercase tracking-wide text-bad">Overdue ({overdue.length})</p>
          <ul>{overdue.map(row)}</ul>
        </div>
      )}
      {todays.length > 0 && (
        <div>
          <p className="text-[11px] font-mono uppercase tracking-wide text-ink-faint">Today ({todays.length})</p>
          <ul>{todays.map(row)}</ul>
        </div>
      )}
    </section>
  );
}
