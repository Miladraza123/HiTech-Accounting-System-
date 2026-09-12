import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner } from "@/lib/auth";
import { TaskActionButtons } from "@/components/TaskActionButtons";
import { EditTaskForm } from "@/components/EditTaskForm";
import { relatedEntityLink } from "@/lib/taskLinks";

const STATUS_STYLE: Record<string, string> = {
  Open: "bg-ledger-soft text-ledger",
  Done: "bg-good-soft text-good",
  Cancelled: "bg-surface-2 text-ink-faint",
};

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const supabase = await createClient();
  const [{ data: task }, { data: profiles }] = await Promise.all([
    supabase.from("tasks").select("*, profiles(full_name)").eq("id", id).maybeSingle(),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
  ]);

  if (!task) notFound();

  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const assigneeName = (task.profiles as unknown as { full_name: string } | null)?.full_name ?? "—";
  const creatorName = task.created_by ? nameById.get(task.created_by) ?? "—" : "—";
  const completedByName = task.completed_by ? nameById.get(task.completed_by) ?? "—" : null;
  const link = relatedEntityLink(task.related_table, task.related_id);

  const canAct = isOwner(user) || user.id === task.assigned_to || user.id === task.created_by;
  const canCancel = isOwner(user) || user.id === task.created_by;
  const canEdit = task.status === "Open" && (isOwner(user) || user.id === task.created_by);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/tasks" className="text-xs text-ink-faint hover:text-ink">
          ← Tasks
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold text-ink">{task.title}</h1>
          <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[task.status] ?? ""}`}>{task.status}</span>
        </div>
        {link && (
          <p className="text-sm text-ink-soft mt-0.5">
            Linked to:{" "}
            <Link href={link.href} className="text-accent-ink underline underline-offset-2">
              {link.label}
            </Link>
          </p>
        )}
      </div>

      {task.status === "Cancelled" && task.cancel_reason && (
        <div className="rounded-md bg-bad-soft border border-bad px-4 py-2 text-sm text-bad">Cancellation reason: {task.cancel_reason}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl border border-line bg-surface p-5 space-y-3 text-sm">
            {task.description && (
              <div>
                <p className="text-xs text-ink-faint">Description</p>
                <p className="text-ink mt-0.5 whitespace-pre-wrap">{task.description}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <Field label="Assigned To" value={assigneeName} />
              <Field label="Priority" value={task.priority} />
              <Field label="Due Date" value={task.due_date ?? "—"} />
              <Field label="Created By" value={creatorName} />
              {completedByName && <Field label="Completed By" value={completedByName} />}
              {task.completed_at && <Field label="Completed At" value={new Date(task.completed_at).toLocaleString("en-PK")} />}
            </div>
          </div>

          {canEdit && <EditTaskForm taskId={id} profiles={profiles ?? []} initial={{ title: task.title, description: task.description, assigned_to: task.assigned_to, due_date: task.due_date, priority: task.priority }} />}
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-line bg-surface p-4">
            <h2 className="text-sm font-semibold text-ink mb-2">Actions</h2>
            <TaskActionButtons taskId={id} status={task.status} canAct={canAct} canCancel={canCancel} revalidateTo={`/tasks/${id}`} size="md" />
            {!canAct && task.status === "Open" && <p className="mt-2 text-xs text-ink-faint">Only the assignee, the task creator, or the Owner can act on this task.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-ink-faint">{label}</p>
      <p className="text-ink">{value}</p>
    </div>
  );
}
