"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateWarehouseAction } from "@/app/actions/setup";
import { diffFields, type SmartMergeConflict } from "@/lib/smartMerge";
import { findPendingEdit } from "@/lib/offlineQueue";
import { useOfflineQueue } from "@/components/OfflineQueueProvider";

const FIELD_LABEL: Record<string, string> = {
  name: "Name",
  address: "Address",
};

// Phase 1 (Master Offline-First Roadmap): warehouses previously had no
// edit capability at all (only toggle active/inactive) — this is the new
// free-edit form the roadmap's Phase 1 promised ("warehouses
// (create/edit)"), wired into the same generic Smart Merge engine and
// offline queue as EditCreditTermsForm.tsx (Party credit terms), which
// this mirrors field-for-field.
export function EditWarehouseForm({
  warehouseId,
  code,
  name,
  address,
}: {
  warehouseId: string;
  code: string;
  name: string;
  address: string | null;
}) {
  const router = useRouter();
  const { isOnline, enqueue } = useOfflineQueue();
  const [open, setOpen] = useState(false);
  const [queuedOffline, setQueuedOffline] = useState(false);
  // `base` is what this tab believes is currently saved — it starts as the
  // page's loaded values and advances whenever a conflict is resolved by
  // accepting the server's value for that one field (Smart Merge).
  const [base, setBase] = useState({ name, address: address ?? "" });
  const [nameVal, setNameVal] = useState(name);
  const [addressVal, setAddressVal] = useState(address ?? "");
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<SmartMergeConflict[]>([]);
  const [pending, startTransition] = useTransition();

  // Phase 0 pending-edit awareness — see CompanyForm.tsx / EditCreditTermsForm.tsx
  // for the same pattern: reopening this editor must never silently show
  // stale server values while an offline edit to this exact row is still
  // sitting unsynced in IndexedDB.
  useEffect(() => {
    let cancelled = false;
    findPendingEdit("warehouses", warehouseId).then((pendingEdit) => {
      if (cancelled || !pendingEdit) return;
      const pendingBase = pendingEdit.base as { name?: string; address?: string };
      const pendingChanges = pendingEdit.changes as { name?: string; address?: string };
      const newBase = {
        name: pendingBase.name ?? name,
        address: pendingBase.address ?? (address ?? ""),
      };
      setBase(newBase);
      setNameVal(pendingChanges.name ?? newBase.name);
      setAddressVal(pendingChanges.address ?? newBase.address);
      setQueuedOffline(true);
    });
    return () => {
      cancelled = true;
    };
  }, [warehouseId, name, address]);

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setOpen(true)} className="text-xs text-accent-ink underline underline-offset-2">
          Edit
        </button>
        {queuedOffline && <span className="text-[11px] text-warn">⏳ Saved offline — waiting to sync</span>}
      </div>
    );
  }

  function submit() {
    setError(null);
    const next = { name: nameVal.trim(), address: addressVal.trim() };
    if (!next.name) {
      setError("Name is required.");
      return;
    }

    // Offline: queue the write for later instead of failing outright. It
    // will be replayed through the exact same Smart Merge RPC the moment
    // connectivity returns — never a blind overwrite.
    if (!isOnline) {
      startTransition(async () => {
        const changes = diffFields(base, next);
        if (Object.keys(changes).length > 0) {
          await enqueue({
            kind: "edit",
            table: "warehouses",
            rowId: warehouseId,
            label: `${code} — Warehouse`,
            base,
            changes,
          });
        }
        setQueuedOffline(true);
        setOpen(false);
      });
      return;
    }

    startTransition(async () => {
      const res = await updateWarehouseAction(warehouseId, base, next);
      if (res.error) {
        setError(res.error);
      } else if (res.conflicts && res.conflicts.length > 0) {
        setConflicts(res.conflicts);
      } else {
        setConflicts([]);
        setOpen(false);
        router.refresh();
      }
    });
  }

  function resolveConflict(conflict: SmartMergeConflict, choice: "mine" | "theirs") {
    const serverValue = String(conflict.server_value ?? "");
    if (conflict.field === "name") {
      setBase((b) => ({ ...b, name: serverValue }));
      if (choice === "theirs") setNameVal(serverValue);
    } else if (conflict.field === "address") {
      setBase((b) => ({ ...b, address: serverValue }));
      if (choice === "theirs") setAddressVal(serverValue);
    }
    setConflicts((cs) => cs.filter((c) => c.field !== conflict.field));
  }

  return (
    <div className="space-y-2 rounded-md border border-line bg-bg p-3">
      {conflicts.length > 0 && (
        <div className="space-y-2 rounded-md border border-warn bg-warn-soft p-2 text-xs text-ink">
          <p className="font-medium text-warn">
            Someone else changed this field in the meantime — you can only keep one value at a time:
          </p>
          {conflicts.map((c) => (
            <div key={c.field} className="space-y-1 rounded border border-line-strong bg-bg p-2">
              <p className="text-ink-soft">
                <span className="font-medium">{FIELD_LABEL[c.field] ?? c.field}</span> — Server:{" "}
                <span className="font-mono">{String(c.server_value ?? "—")}</span>, Your value:{" "}
                <span className="font-mono">{String(c.my_value ?? "—")}</span>
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => resolveConflict(c, "mine")}
                  className="flex-1 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-white"
                >
                  Keep my value
                </button>
                <button
                  type="button"
                  onClick={() => resolveConflict(c, "theirs")}
                  className="flex-1 rounded-md border border-line-strong bg-bg px-2 py-1 text-[11px]"
                >
                  Keep server value
                </button>
              </div>
            </div>
          ))}
          <p className="text-ink-faint">Once you decide, click &quot;Save&quot; again.</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1">
          <span className="text-[11px] text-ink-faint">Name</span>
          <input value={nameVal} onChange={(e) => setNameVal(e.target.value)} className="input !py-1 text-xs" />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] text-ink-faint">Address</span>
          <input value={addressVal} onChange={(e) => setAddressVal(e.target.value)} className="input !py-1 text-xs" />
        </label>
      </div>
      {error && <p className="text-xs text-bad">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setConflicts([]);
          }}
          className="flex-1 rounded-md border border-line-strong bg-bg px-2 py-1 text-xs"
        >
          Back
        </button>
        <button type="button" onClick={submit} disabled={pending} className="flex-1 rounded-md bg-accent px-2 py-1 text-xs font-medium text-white disabled:opacity-60">
          {pending ? "…" : "Save"}
        </button>
      </div>
    </div>
  );
}
