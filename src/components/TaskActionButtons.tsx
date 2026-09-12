"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { completeTaskAction, reopenTaskAction, cancelTaskAction } from "@/app/actions/tasks";

/** Shared Complete / Reopen / Cancel buttons for a task — used on the /tasks list, the /tasks/[id] detail page, and the contextual TasksPanel. */
export function TaskActionButtons({
  taskId,
  status,
  canAct,
  canCancel,
  revalidateTo,
  size = "sm",
}: {
  taskId: string;
  status: string;
  canAct: boolean;
  canCancel: boolean;
  revalidateTo: string;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const pad = size === "md" ? "px-3 py-1.5 text-xs" : "px-2 py-1 text-[11px]";

  function run(fn: () => Promise<{ error: string | null }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else {
        setCancelling(false);
        router.refresh();
      }
    });
  }

  if (cancelling) {
    return (
      <div className="space-y-1.5">
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="Cancel karne ki wajah (optional)…"
          className="input resize-none text-xs"
        />
        {error && <p className="text-xs text-bad">{error}</p>}
        <div className="flex gap-1.5">
          <button type="button" onClick={() => setCancelling(false)} className="flex-1 rounded-md border border-line-strong bg-bg px-2 py-1 text-[11px]">
            Wapis
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => cancelTaskAction(taskId, reason || null, revalidateTo))}
            className="flex-1 rounded-md bg-bad px-2 py-1 text-[11px] font-medium text-white disabled:opacity-60"
          >
            {pending ? "…" : "Confirm"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {status === "Open" && canAct && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => completeTaskAction(taskId, revalidateTo))}
          className={`rounded-md border border-good text-good bg-bg hover:bg-surface-2 transition disabled:opacity-60 ${pad}`}
        >
          Complete
        </button>
      )}
      {status === "Open" && canCancel && (
        <button
          type="button"
          onClick={() => setCancelling(true)}
          className={`rounded-md border border-bad text-bad bg-bg hover:bg-surface-2 transition ${pad}`}
        >
          Cancel
        </button>
      )}
      {status !== "Open" && canAct && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => reopenTaskAction(taskId, revalidateTo))}
          className={`rounded-md border border-line-strong bg-bg text-ink hover:bg-surface-2 transition disabled:opacity-60 ${pad}`}
        >
          Reopen
        </button>
      )}
      {error && !cancelling && <p className="text-xs text-bad w-full">{error}</p>}
    </div>
  );
}
