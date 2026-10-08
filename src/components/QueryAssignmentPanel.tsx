"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createQueryAssignmentAction, acceptQueryAssignmentAction, completeQueryAssignmentAction } from "@/app/actions/queries";

const STATUS_STYLE: Record<string, string> = {
  Pending: "bg-warn-soft text-warn",
  Accepted: "bg-ledger-soft text-ledger",
  Completed: "bg-good-soft text-good",
};

export type QueryAssignmentRow = { id: string; assigned_to: string; assigned_to_name: string; assigned_by_name: string; status: string; created_at: string };

/**
 * Office -> Engineer/Rider costing hand-off on a Query — e.g. an Office
 * employee creates the Query, then assigns an Engineer to go price it
 * on-site. Mirrors DispatchGoAheadPanel's exact Accept/Complete +
 * notification shape (see fn_create_query_assignment and siblings).
 */
export function QueryAssignmentPanel({
  queryId,
  assignments,
  currentUserId,
  canAssign,
  profiles,
}: {
  queryId: string;
  assignments: QueryAssignmentRow[];
  currentUserId: string;
  /** Owner/Sales — matches fn_create_query_assignment's own gate. */
  canAssign: boolean;
  profiles: { id: string; full_name: string }[];
}) {
  const router = useRouter();
  const [assignedTo, setAssignedTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function assign() {
    setError(null);
    if (!assignedTo) {
      setError("Select who to assign this Query to.");
      return;
    }
    startTransition(async () => {
      const res = await createQueryAssignmentAction(queryId, assignedTo);
      if (res.error) setError(res.error);
      else {
        setAssignedTo("");
        router.refresh();
      }
    });
  }

  function accept(assignmentId: string) {
    startTransition(async () => {
      await acceptQueryAssignmentAction(assignmentId, queryId);
      router.refresh();
    });
  }

  function complete(assignmentId: string) {
    startTransition(async () => {
      await completeQueryAssignmentAction(assignmentId, queryId);
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
      <h2 className="text-sm font-semibold text-ink">Assignment (e.g. Engineer/Rider costing)</h2>

      {assignments.map((a) => (
        <div key={a.id} className="rounded-md border border-line p-2.5 space-y-1.5 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-ink-soft text-xs">{a.assigned_by_name} → {a.assigned_to_name}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[a.status] ?? ""}`}>{a.status}</span>
          </div>
          {a.assigned_to === currentUserId && a.status === "Pending" && (
            <button type="button" onClick={() => accept(a.id)} disabled={pending} className="w-full rounded-md bg-accent px-2 py-1.5 text-xs font-medium text-white disabled:opacity-60">
              {pending ? "…" : "Accept"}
            </button>
          )}
          {a.assigned_to === currentUserId && a.status === "Accepted" && (
            <button type="button" onClick={() => complete(a.id)} disabled={pending} className="w-full rounded-md bg-good px-2 py-1.5 text-xs font-medium text-white disabled:opacity-60">
              {pending ? "…" : "Mark Complete"}
            </button>
          )}
        </div>
      ))}
      {!assignments.length && <p className="text-xs text-ink-faint">Not assigned to anyone yet.</p>}

      {canAssign && !assignments.some((a) => a.status === "Pending") && (
        <div className="space-y-2 border-t border-line pt-3">
          <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="input !py-1.5 text-xs">
            <option value="">— Select person —</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
          {error && <p className="text-xs text-bad">{error}</p>}
          <button type="button" onClick={assign} disabled={pending} className="w-full rounded-md border border-line bg-bg px-2 py-1.5 text-xs text-ink-soft hover:bg-surface-2 disabled:opacity-60">
            {pending ? "…" : "Assign"}
          </button>
        </div>
      )}
    </div>
  );
}
