import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner } from "@/lib/auth";
import { karachiNow } from "@/lib/recurringTasks";
import { RecurringTasksManager, type RecurringRuleRow } from "@/components/RecurringTasksManager";

export default async function RecurringTasksPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const owner = isOwner(user);

  const supabase = await createClient();
  const [{ data: rules }, { data: profiles }] = await Promise.all([
    supabase.from("recurring_tasks").select("*").order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
  ]);
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  // Everyone sees their own; the Owner sees (and can edit) everyone's. RLS already filters this.
  const mine = (rules ?? []).filter((r) => owner || r.assigned_to === user.id);

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <Link href="/tasks" className="text-xs text-ink-faint hover:text-ink">
          ← Tasks &amp; Follow-ups
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-ink">Recurring Tasks</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Set a task once and it appears in Today&apos;s Tasks on the day it repeats, as a normal task you can accept and complete. Several tasks can share a date.
        </p>
      </div>
      <RecurringTasksManager
        rules={mine.map(
          (r): RecurringRuleRow => ({
            id: r.id,
            title: r.title,
            description: r.description,
            assigned_to: r.assigned_to,
            assignee_name: nameById.get(r.assigned_to) ?? "—",
            priority: r.priority as RecurringRuleRow["priority"],
            frequency: r.frequency as RecurringRuleRow["frequency"],
            weekdays: r.weekdays,
            month_day: r.month_day,
            month: r.month,
            due_time: r.due_time,
            start_date: r.start_date,
            end_date: r.end_date,
            is_active: r.is_active,
          })
        )}
        today={karachiNow().date}
        people={owner ? (profiles ?? []).filter((p) => p.id !== user.id) : []}
        isOwner={owner}
        currentUserId={user.id}
      />
    </div>
  );
}
