"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Generic "really delete this?" control for the handful of master-data
 * rows that can be hard-deleted — Owner-only, and only once the server
 * confirms nothing already references the row (fn_delete_master_row
 * rejects the delete with a friendly message instead). Mirrors
 * CancelWithReasonButton's confirm-then-submit shape, minus the reason
 * field a delete has nothing to explain.
 */
export function DeleteMasterRowButton({
  label = "Delete",
  onDelete,
}: {
  label?: string;
  onDelete: () => Promise<{ error: string | null }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-bad underline underline-offset-2">
        {label}
      </button>
    );
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await onDelete();
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-1.5 rounded-md border border-bad bg-bad-soft p-2">
      <p className="text-xs text-bad">Delete permanently? This cannot be undone.</p>
      {error && <p className="text-xs text-bad">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className="flex-1 rounded-md border border-line-strong bg-bg px-2 py-1 text-xs">
          Cancel
        </button>
        <button type="button" onClick={submit} disabled={pending} className="flex-1 rounded-md bg-bad px-2 py-1 text-xs font-medium text-white disabled:opacity-60">
          {pending ? "…" : "Confirm Delete"}
        </button>
      </div>
    </div>
  );
}
