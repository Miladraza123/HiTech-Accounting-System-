"use client";

import { useTransition } from "react";
import { assignRoleAction, revokeRoleAction } from "@/app/actions/setup";
import { ROLE_LABELS } from "@/lib/roles";

export function RoleAssignRow({
  userId,
  assignedRoleIds,
  allRoles,
}: {
  userId: string;
  assignedRoleIds: string[];
  allRoles: { id: string; code: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const available = allRoles.filter((r) => !assignedRoleIds.includes(r.id));

  return (
    <div className="flex items-center gap-2">
      {available.length > 0 && (
        <select
          disabled={pending}
          defaultValue=""
          onChange={(e) => {
            const roleId = e.target.value;
            if (!roleId) return;
            startTransition(async () => {
              await assignRoleAction(userId, roleId);
            });
            e.target.value = "";
          }}
          className="text-xs rounded-md border border-line bg-bg px-2 py-1 text-ink"
        >
          <option value="">+ Assign Role</option>
          {available.map((r) => (
            <option key={r.id} value={r.id}>
              {ROLE_LABELS[r.code] ?? r.code}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function RevokeRoleChip({
  userId,
  roleId,
  label,
}: {
  userId: string;
  roleId: string;
  label: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => revokeRoleAction(userId, roleId))}
      title="Click to remove"
      className="inline-flex items-center gap-1 rounded-full bg-ledger-soft px-2 py-0.5 text-xs text-ledger disabled:opacity-50"
    >
      {label} <span aria-hidden>×</span>
    </button>
  );
}
