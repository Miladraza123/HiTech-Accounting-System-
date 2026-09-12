"use client";

import { useState, useTransition } from "react";
import { setRolePermissionAction } from "@/app/actions/permissions";
import { PERMISSION_DEFS, PERMISSION_MODULES, type PermissionKey } from "@/lib/permissionDefs";
import { ROLE_LABELS } from "@/lib/roles";

const ROLE_COLUMNS = ["sales", "store", "production", "dispatch", "accounts"];

export function PermissionMatrixTable({ initialMatrix }: { initialMatrix: Record<PermissionKey, string[]> }) {
  const [matrix, setMatrix] = useState(initialMatrix);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function toggle(key: PermissionKey, role: string, dbAllowed: boolean) {
    if (!dbAllowed) return;
    setError(null);
    const current = matrix[key] ?? [];
    const next = current.includes(role) ? current.filter((r) => r !== role) : [...current, role];
    setMatrix((m) => ({ ...m, [key]: next }));
    setPendingKey(`${key}:${role}`);
    startTransition(async () => {
      const res = await setRolePermissionAction(key, next);
      setPendingKey(null);
      if (res.error) {
        setError(res.error);
        setMatrix((m) => ({ ...m, [key]: current }));
      }
    });
  }

  return (
    <div className="space-y-6">
      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      {PERMISSION_MODULES.map((mod) => (
        <div key={mod} className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="px-4 py-2.5 border-b border-line">
            <h2 className="text-sm font-semibold text-ink">{mod}</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="text-left px-3 py-2">Action</th>
                  {ROLE_COLUMNS.map((r) => (
                    <th key={r} className="text-center px-3 py-2 whitespace-nowrap">
                      {ROLE_LABELS[r]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSION_DEFS.filter((d) => d.module === mod).map((def) => (
                  <tr key={def.key} className="border-t border-line">
                    <td className="px-3 py-2 text-ink">{def.label}</td>
                    {ROLE_COLUMNS.map((r) => {
                      const dbAllowed = def.dbAllowedRoles.includes(r);
                      const checked = (matrix[def.key] ?? []).includes(r);
                      const busy = pendingKey === `${def.key}:${r}`;
                      return (
                        <td key={r} className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!dbAllowed || busy}
                            onChange={() => toggle(def.key, r, dbAllowed)}
                            title={dbAllowed ? undefined : "The database does not allow this role for this action — granting it from the matrix will not work."}
                            className="h-4 w-4 accent-accent disabled:opacity-25 disabled:cursor-not-allowed"
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
