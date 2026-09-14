"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateVehicleAction } from "@/app/actions/vehicles";
import { diffFields } from "@/lib/smartMerge";
import { findPendingEdit } from "@/lib/offlineQueue";
import { useOfflineQueue } from "@/components/OfflineQueueProvider";
import type { Tables } from "@/lib/supabase/database.types";

const STATUSES = ["Active", "UnderMaintenance", "Retired", "Unassigned"] as const;

// Phase 8 (Master Offline-First Roadmap): now goes through the generic
// Smart Merge engine (see updateVehicleAction) instead of a direct
// `.update()` — wired into the same offline queue + pending-edit-aware
// pattern as EditWarehouseForm.tsx, which this mirrors field-for-field.
export function EditVehicleForm({
  vehicleId,
  currentAssignedUserId,
  currentAssignmentDate,
  currentStatus,
  profiles,
}: {
  vehicleId: string;
  currentAssignedUserId: string | null;
  currentAssignmentDate: string | null;
  currentStatus: string;
  profiles: Tables<"profiles">[];
}) {
  const router = useRouter();
  const { isOnline, enqueue } = useOfflineQueue();
  const [queuedOffline, setQueuedOffline] = useState(false);
  // `base` is what this tab believes is currently saved — see
  // EditWarehouseForm.tsx for the full rationale.
  const [base, setBase] = useState({
    assigned_user_id: currentAssignedUserId,
    assignment_date: currentAssignmentDate,
    status: currentStatus,
  });
  const [assignedUserId, setAssignedUserId] = useState(currentAssignedUserId ?? "");
  const [assignmentDate, setAssignmentDate] = useState(currentAssignmentDate ?? new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<(typeof STATUSES)[number]>(currentStatus as (typeof STATUSES)[number]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Phase 0 pending-edit awareness — see EditWarehouseForm.tsx for the
  // same pattern.
  useEffect(() => {
    let cancelled = false;
    findPendingEdit("vehicles", vehicleId).then((pendingEdit) => {
      if (cancelled || !pendingEdit) return;
      const pendingBase = pendingEdit.base as { assigned_user_id?: string | null; assignment_date?: string | null; status?: string };
      const pendingChanges = pendingEdit.changes as { assigned_user_id?: string | null; assignment_date?: string | null; status?: string };
      const newBase = {
        assigned_user_id: pendingBase.assigned_user_id ?? currentAssignedUserId,
        assignment_date: pendingBase.assignment_date ?? currentAssignmentDate,
        status: pendingBase.status ?? currentStatus,
      };
      setBase(newBase);
      setAssignedUserId((pendingChanges.assigned_user_id ?? newBase.assigned_user_id) ?? "");
      setAssignmentDate((pendingChanges.assignment_date ?? newBase.assignment_date) ?? new Date().toISOString().slice(0, 10));
      setStatus((pendingChanges.status ?? newBase.status) as (typeof STATUSES)[number]);
      setQueuedOffline(true);
    });
    return () => {
      cancelled = true;
    };
  }, [vehicleId, currentAssignedUserId, currentAssignmentDate, currentStatus]);

  function submit() {
    setError(null);
    const next = {
      assigned_user_id: assignedUserId || null,
      assignment_date: assignedUserId ? assignmentDate : null,
      status,
    };

    // Offline: queue the write for later instead of failing outright —
    // replayed through the exact same Smart Merge RPC once connectivity
    // returns, never a blind overwrite.
    if (!isOnline) {
      startTransition(async () => {
        const changes = diffFields(base, next);
        if (Object.keys(changes).length > 0) {
          await enqueue({
            kind: "edit",
            table: "vehicles",
            rowId: vehicleId,
            label: "Vehicle assignment/status",
            base,
            changes,
          });
        }
        setQueuedOffline(true);
      });
      return;
    }

    startTransition(async () => {
      const res = await updateVehicleAction(vehicleId, base, next);
      if (res.error) setError(res.error);
      else if (res.conflicts && res.conflicts.length > 0) {
        // A field-level conflict here is rare (assignment/status change
        // colliding with another tab's) — surface it plainly rather than
        // building a second bespoke resolver UI for a two-field form.
        setError(
          `Someone else changed this in the meantime (${res.conflicts.map((c) => c.field).join(", ")}) — refresh and try again.`
        );
      } else router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {queuedOffline && <p className="text-[11px] text-warn">⏳ Saved offline — waiting to sync</p>}
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-ink-soft">Assigned Engineer/Rider</span>
        <select value={assignedUserId} onChange={(e) => setAssignedUserId(e.target.value)} className="input !py-1.5 text-sm">
          <option value="">— Unassigned —</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
      </label>
      {assignedUserId && (
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Assignment Date</span>
          <input type="date" value={assignmentDate} onChange={(e) => setAssignmentDate(e.target.value)} className="input !py-1.5 text-sm" />
        </label>
      )}
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-ink-soft">Status</span>
        <select value={status} onChange={(e) => setStatus(e.target.value as (typeof STATUSES)[number])} className="input !py-1.5 text-sm">
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      {!isOnline && <p className="text-[11px] text-warn">⏳ Offline — this will be saved on this device and synced automatically.</p>}
      {error && <p className="text-xs text-bad">{error}</p>}
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="w-full rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "…" : isOnline ? "Update Karen" : "Save Offline"}
      </button>
    </div>
  );
}
