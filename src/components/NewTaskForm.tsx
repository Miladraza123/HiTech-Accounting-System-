"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTaskAction, type TaskPriority } from "@/app/actions/tasks";
import { useOfflineQueue } from "@/components/OfflineQueueProvider";
import { buttonClass } from "@/components/ui/Button";

type LinkType = "none" | "sales_orders" | "purchase_orders" | "jobs" | "parties";

const LINK_TYPE_LABEL: Record<LinkType, string> = {
  none: "No link (General Task)",
  sales_orders: "Sales Order",
  purchase_orders: "Purchase Order",
  jobs: "Job",
  parties: "Client / Supplier",
};

/**
 * Offline-first (Phase 25, extending the Phase 22 Query pilot): creating
 * a Task while offline saves safely on the device (IndexedDB) instead of
 * failing. Task is single-row with no sequential document number at all,
 * so — unlike Query — there isn't even a numbering race to avoid. When
 * online, this behaves exactly as before; when offline, submission is
 * intercepted before calling createTaskAction and the entry is queued
 * with a browser-generated UUID, replayed by OfflineQueueProvider
 * through `fn_create_task_idempotent` once connectivity returns.
 */
export function NewTaskForm({
  profiles,
  salesOrders,
  purchaseOrders,
  jobs,
  parties,
}: {
  profiles: { id: string; full_name: string }[];
  salesOrders: { id: string; label: string }[];
  purchaseOrders: { id: string; label: string }[];
  jobs: { id: string; label: string }[];
  parties: { id: string; label: string }[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const { isOnline, enqueue } = useOfflineQueue();
  const [assignedTo, setAssignedTo] = useState(profiles[0]?.id ?? "");
  const [priority, setPriority] = useState<TaskPriority>("Medium");
  const [dueDate, setDueDate] = useState("");
  const [linkType, setLinkType] = useState<LinkType>("none");
  const [linkId, setLinkId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savedOffline, setSavedOffline] = useState(false);
  const [pending, startTransition] = useTransition();

  const linkOptions: { id: string; label: string }[] =
    linkType === "sales_orders" ? salesOrders : linkType === "purchase_orders" ? purchaseOrders : linkType === "jobs" ? jobs : linkType === "parties" ? parties : [];

  function submit(formData: FormData) {
    setError(null);
    const title = String(formData.get("title") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    if (!title) {
      setError("Task title is required.");
      return;
    }
    if (!assignedTo) {
      setError("Select a user to assign to.");
      return;
    }
    if (linkType !== "none" && !linkId) {
      setError("Select a record to link, or choose 'No link'.");
      return;
    }

    if (!isOnline) {
      startTransition(async () => {
        await enqueue({
          kind: "create",
          table: "tasks",
          recordId: crypto.randomUUID(),
          label: "Task",
          payload: {
            title,
            description: description || null,
            assigned_to: assignedTo,
            due_date: dueDate || null,
            priority,
            related_table: linkType === "none" ? null : linkType,
            related_id: linkType === "none" ? null : linkId,
          },
        });
        formRef.current?.reset();
        setSavedOffline(true);
      });
      return;
    }

    startTransition(async () => {
      const res = await createTaskAction(
        {
          title,
          description: description || null,
          assigned_to: assignedTo,
          due_date: dueDate || null,
          priority,
          related_table: linkType === "none" ? null : linkType,
          related_id: linkType === "none" ? null : linkId,
        },
        "/tasks"
      );
      if (res.error) setError(res.error);
      else if (res.id) router.push(`/tasks/${res.id}`);
    });
  }

  if (savedOffline) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 max-w-xl space-y-3">
        <p className="rounded-md bg-good-soft px-3 py-2 text-sm text-good">
          Task saved on this device — it will sync automatically once you&apos;re back online.
        </p>
        <button type="button" onClick={() => setSavedOffline(false)} className={buttonClass("secondary", "sm")}>
          + Add another Task
        </button>
      </div>
    );
  }

  return (
    <form ref={formRef} action={submit} className="rounded-xl border border-line bg-surface p-5 space-y-3 max-w-xl">
      <div>
        <label className="text-xs text-ink-faint">Title</label>
        <input name="title" required placeholder="e.g. Follow up with client for advance payment" className="input mt-1" />
      </div>
      <div>
        <label className="text-xs text-ink-faint">Description (optional)</label>
        <textarea name="description" rows={3} className="input mt-1 resize-none" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-ink-faint">Assign To</label>
          <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="input mt-1">
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-ink-faint">Priority</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className="input mt-1">
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
          </select>
        </div>
      </div>
      <div>
        <label className="text-xs text-ink-faint">Due Date (optional)</label>
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input mt-1" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-ink-faint">Link To</label>
          <select
            value={linkType}
            onChange={(e) => {
              setLinkType(e.target.value as LinkType);
              setLinkId("");
            }}
            className="input mt-1"
          >
            {(Object.keys(LINK_TYPE_LABEL) as LinkType[]).map((k) => (
              <option key={k} value={k}>
                {LINK_TYPE_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        {linkType !== "none" && (
          <div>
            <label className="text-xs text-ink-faint">Record</label>
            <select value={linkId} onChange={(e) => setLinkId(e.target.value)} className="input mt-1">
              <option value="">— Select —</option>
              {linkOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {!isOnline && (
        <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
          ⏳ You&apos;re offline — this Task will be saved on this device and synced automatically once you&apos;re
          back online.
        </p>
      )}

      {error && <p className="text-xs text-bad">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Saving…" : isOnline ? "Create Task" : "Save Offline"}
      </button>
    </form>
  );
}
