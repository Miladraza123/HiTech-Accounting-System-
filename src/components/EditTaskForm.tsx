"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateTaskAction, type TaskPriority } from "@/app/actions/tasks";

export function EditTaskForm({
  taskId,
  profiles,
  initial,
}: {
  taskId: string;
  profiles: { id: string; full_name: string }[];
  initial: { title: string; description: string | null; assigned_to: string; due_date: string | null; priority: string };
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description ?? "");
  const [assignedTo, setAssignedTo] = useState(initial.assigned_to);
  const [dueDate, setDueDate] = useState(initial.due_date ?? "");
  const [priority, setPriority] = useState<TaskPriority>((initial.priority as TaskPriority) ?? "Medium");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    if (!title.trim()) {
      setError("Task title zaroori hai.");
      return;
    }
    startTransition(async () => {
      const res = await updateTaskAction(
        taskId,
        { title: title.trim(), description: description.trim() || null, assigned_to: assignedTo, due_date: dueDate || null, priority },
        `/tasks/${taskId}`
      );
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
      <h2 className="text-sm font-semibold text-ink">Edit Task</h2>
      <input value={title} onChange={(e) => setTitle(e.target.value)} className="input text-sm" placeholder="Title" />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="input text-sm resize-none" placeholder="Description" />
      <div className="grid grid-cols-2 gap-2">
        <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="input text-sm">
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className="input text-sm">
          <option value="Low">Low</option>
          <option value="Medium">Medium</option>
          <option value="High">High</option>
        </select>
      </div>
      <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input text-sm" />
      {error && <p className="text-xs text-bad">{error}</p>}
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="w-full rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Save ho raha hai…" : "Changes Save Karen"}
      </button>
    </div>
  );
}
