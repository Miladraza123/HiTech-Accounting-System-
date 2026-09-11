"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateVehicleAction } from "@/app/actions/vehicles";
import type { Tables } from "@/lib/supabase/database.types";

const STATUSES = ["Active", "UnderMaintenance", "Retired", "Unassigned"] as const;

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
  const [assignedUserId, setAssignedUserId] = useState(currentAssignedUserId ?? "");
  const [assignmentDate, setAssignmentDate] = useState(currentAssignmentDate ?? new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<(typeof STATUSES)[number]>(currentStatus as (typeof STATUSES)[number]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await updateVehicleAction(vehicleId, {
        assigned_user_id: assignedUserId || null,
        assignment_date: assignedUserId ? assignmentDate : null,
        status,
      });
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-3">
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
      {error && <p className="text-xs text-bad">{error}</p>}
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="w-full rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "…" : "Update Karen"}
      </button>
    </div>
  );
}
