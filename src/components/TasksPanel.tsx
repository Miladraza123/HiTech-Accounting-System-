"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { createTaskAction, type TaskPriority } from "@/app/actions/tasks";
import { TaskActionButtons } from "@/components/TaskActionButtons";

export type TaskRow = {
  id: string;
  title: string;
  due_date: string | null;
  priority: string;
  status: string;
  assigned_to: string;
  assignee_name: string;
  created_by: string | null;
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

function isOverdue(dueDate: string | null, status: string): boolean {
  if (!dueDate || status !== "Open") return false;
  return new Date(dueDate).getTime() < new Date(new Date().toISOString().slice(0, 10)).getTime();
}

export function TasksPanel({
  relatedTable,
  relatedId,
  revalidateTo,
  tasks,
  profiles,
  currentUserId,
  isOwnerUser,
  canAdd,
}: {
  relatedTable: string;
  relatedId: string;
  revalidateTo: string;
  tasks: TaskRow[];
  profiles: { id: string; full_name: string }[];
  currentUserId: string;
  isOwnerUser: boolean;
  canAdd: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignedTo, setAssignedTo] = useState(profiles[0]?.id ?? "");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("Medium");
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  function submitNew(formData: FormData) {
    setError(null);
    const title = String(formData.get("title") ?? "").trim();
    if (!title) {
      setError("Task title is required.");
      return;
    }
    if (!assignedTo) {
      setError("Select a user to assign to.");
      return;
    }
    startTransition(async () => {
      const res = await createTaskAction(
        {
          title,
          description: null,
          assigned_to: assignedTo,
          due_date: dueDate || null,
          priority,
          related_table: relatedTable,
          related_id: relatedId,
        },
        revalidateTo
      );
      if (res.error) setError(res.error);
      else {
        formRef.current?.reset();
        setDueDate("");
        setPriority("Medium");
        setOpen(false);
      }
    });
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {tasks.map((t) => {
          const canAct = isOwnerUser || currentUserId === t.assigned_to || currentUserId === t.created_by;
          const canCancel = isOwnerUser || currentUserId === t.created_by;
          const overdue = isOverdue(t.due_date, t.status);
          return (
            <li key={t.id} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/tasks/${t.id}`} className="text-ink hover:underline underline-offset-2">
                    {t.title}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-faint">
                    <span className={`rounded-full px-1.5 py-0.5 font-mono ${STATUS_STYLE[t.status] ?? ""}`}>{t.status}</span>
                    <span className={PRIORITY_STYLE[t.priority] ?? ""}>{t.priority}</span>
                    <span>{t.assignee_name}</span>
                    {t.due_date && <span className={overdue ? "text-bad font-medium" : ""}>Due: {t.due_date}</span>}
                  </div>
                </div>
                <div className="shrink-0">
                  <TaskActionButtons taskId={t.id} status={t.status} canAct={canAct} canCancel={canCancel} revalidateTo={revalidateTo} />
                </div>
              </div>
            </li>
          );
        })}
        {!tasks.length && <li className="text-xs text-ink-faint">No tasks.</li>}
      </ul>

      {error && <p className="text-xs text-bad">{error}</p>}

      {canAdd && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full rounded-md border border-line-strong bg-bg px-3 py-1.5 text-xs text-ink hover:bg-surface-2 transition"
        >
          + Add Task / Follow-up
        </button>
      )}

      {canAdd && open && (
        <form ref={formRef} action={submitNew} className="rounded-xl border border-line bg-surface p-3 space-y-2">
          <input name="title" placeholder="Task title…" required className="input text-xs" />
          <div className="grid grid-cols-2 gap-2">
            <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="input !py-1.5 text-xs">
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
            <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className="input !py-1.5 text-xs">
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
          </div>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input !py-1.5 text-xs" />
          <div className="flex gap-2">
            <button type="button" onClick={() => setOpen(false)} className="flex-1 rounded-md border border-line-strong bg-bg px-2 py-1.5 text-xs">
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="flex-1 rounded-md bg-accent px-2 py-1.5 text-xs font-medium text-white hover:opacity-90 transition disabled:opacity-60"
            >
              {pending ? "…" : "Add"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
