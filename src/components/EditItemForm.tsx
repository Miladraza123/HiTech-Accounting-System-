"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateItemAction, type ItemEditableFields } from "@/app/actions/items";
import { diffFields, type SmartMergeConflict } from "@/lib/smartMerge";
import { findPendingEdit } from "@/lib/offlineQueue";
import { useOfflineQueue } from "@/components/OfflineQueueProvider";
import type { Tables } from "@/lib/supabase/database.types";

const FIELD_LABEL: Record<string, string> = {
  item_code: "Item Code",
  description: "Description",
  category: "Category",
  spec: "Spec",
  base_unit: "Unit",
  hs_code: "HS Code",
  tax_category: "Tax Category",
  is_stocked: "Stocked?",
  standard_cost: "Standard Cost",
};

const TAX_OPTIONS = [
  { value: "standard", label: "Standard Tax" },
  { value: "reduced", label: "Reduced Rate" },
  { value: "zero_rated", label: "Zero-rated" },
  { value: "exempt", label: "Exempt" },
];

// Every Item Master field, previously not editable after creation at all
// (only reorder_level and the active toggle had their own edit paths).
// Mirrors EditWarehouseForm.tsx / EditVehicleForm.tsx: an "Edit" toggle
// revealing a Smart Merge form, offline-safe via the same queue path.
export function EditItemForm({
  itemId,
  item,
  units,
}: {
  itemId: string;
  item: ItemEditableFields;
  units: Tables<"units">[];
}) {
  const router = useRouter();
  const { isOnline, enqueue } = useOfflineQueue();
  const [open, setOpen] = useState(false);
  const [queuedOffline, setQueuedOffline] = useState(false);
  const [base, setBase] = useState<ItemEditableFields>(item);
  const [form, setForm] = useState<ItemEditableFields>(item);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<SmartMergeConflict[]>([]);
  const [pending, startTransition] = useTransition();

  // Phase 0 pending-edit awareness — see EditWarehouseForm.tsx for the
  // full rationale: reopening this editor must never silently show a
  // stale server value while an offline edit to this exact row is still
  // sitting unsynced in IndexedDB.
  useEffect(() => {
    let cancelled = false;
    findPendingEdit("items", itemId).then((pendingEdit) => {
      if (cancelled || !pendingEdit) return;
      const pendingBase = pendingEdit.base as Partial<ItemEditableFields>;
      const pendingChanges = pendingEdit.changes as Partial<ItemEditableFields>;
      const newBase = { ...item, ...pendingBase };
      setBase(newBase);
      setForm({ ...newBase, ...pendingChanges });
      setQueuedOffline(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setOpen(true)} className="text-xs text-accent-ink underline underline-offset-2">
          Edit Item
        </button>
        {queuedOffline && <span className="text-[11px] text-warn">⏳ Saved offline — waiting to sync</span>}
      </div>
    );
  }

  function submit() {
    setError(null);
    const next: ItemEditableFields = {
      ...form,
      item_code: form.item_code.trim(),
      description: form.description.trim(),
      category: form.category?.trim() || null,
      spec: form.spec?.trim() || null,
      hs_code: form.hs_code?.trim() || null,
    };
    if (!next.item_code || !next.description || !next.base_unit) {
      setError("Item code, description, and unit are required.");
      return;
    }

    // Offline: queue the write for later instead of failing outright — it
    // will be replayed through the exact same Smart Merge RPC once
    // connectivity returns, never a blind overwrite.
    if (!isOnline) {
      startTransition(async () => {
        const changes = diffFields(base, next);
        if (Object.keys(changes).length > 0) {
          await enqueue({
            kind: "edit",
            table: "items",
            rowId: itemId,
            label: `${base.item_code} — Item`,
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
      const res = await updateItemAction(itemId, base, next);
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
    const field = conflict.field as keyof ItemEditableFields;
    const raw = conflict.server_value;
    const serverValue =
      field === "is_stocked"
        ? raw === true || raw === "true"
        : field === "standard_cost"
          ? Number(raw ?? 0)
          : field === "category" || field === "spec" || field === "hs_code"
            ? raw === null || raw === undefined
              ? null
              : String(raw)
            : String(raw ?? "");

    setBase((b) => ({ ...b, [field]: serverValue }) as ItemEditableFields);
    if (choice === "theirs") setForm((f) => ({ ...f, [field]: serverValue }) as ItemEditableFields);
    setConflicts((cs) => cs.filter((c) => c.field !== conflict.field));
  }

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
      <h2 className="text-sm font-semibold text-ink">Edit Item</h2>

      {conflicts.length > 0 && (
        <div className="space-y-2 rounded-md border border-warn bg-warn-soft p-2 text-xs text-ink">
          <p className="font-medium text-warn">
            Someone else changed this in the meantime — you can only keep one value at a time:
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

      <div className="grid grid-cols-[140px_1fr] gap-3">
        <label className="block space-y-1">
          <span className="text-[11px] text-ink-faint">Item Code</span>
          <input
            value={form.item_code}
            onChange={(e) => setForm((f) => ({ ...f, item_code: e.target.value }))}
            className="input !py-1.5 text-sm font-mono"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] text-ink-faint">Description</span>
          <input
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className="input !py-1.5 text-sm"
          />
        </label>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <label className="block space-y-1">
          <span className="text-[11px] text-ink-faint">Category</span>
          <input
            value={form.category ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            className="input !py-1.5 text-sm"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] text-ink-faint">Spec</span>
          <input
            value={form.spec ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, spec: e.target.value }))}
            className="input !py-1.5 text-sm"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] text-ink-faint">HS Code</span>
          <input
            value={form.hs_code ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, hs_code: e.target.value }))}
            className="input !py-1.5 text-sm"
          />
        </label>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <label className="block space-y-1">
          <span className="text-[11px] text-ink-faint">Unit</span>
          <select
            value={form.base_unit}
            onChange={(e) => setForm((f) => ({ ...f, base_unit: e.target.value }))}
            className="input !py-1.5 text-sm"
          >
            {units.map((u) => (
              <option key={u.code} value={u.code}>
                {u.code} — {u.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] text-ink-faint">Tax Category</span>
          <select
            value={form.tax_category}
            onChange={(e) => setForm((f) => ({ ...f, tax_category: e.target.value }))}
            className="input !py-1.5 text-sm"
          >
            {TAX_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] text-ink-faint">Standard Cost</span>
          <input
            type="number"
            step="0.0001"
            min="0"
            value={form.standard_cost}
            onChange={(e) => setForm((f) => ({ ...f, standard_cost: Number(e.target.value) || 0 }))}
            className="input !py-1.5 text-sm"
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-soft">
        <input
          type="checkbox"
          checked={form.is_stocked}
          onChange={(e) => setForm((f) => ({ ...f, is_stocked: e.target.checked }))}
          className="h-3.5 w-3.5 accent-[var(--accent)]"
        />
        This item is kept in warehouse stock
      </label>

      {!isOnline && <p className="text-[11px] text-warn">⏳ Offline — this will be saved on this device and synced automatically.</p>}
      {error && <p className="text-xs text-bad">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setConflicts([]);
            setForm(base);
          }}
          className="flex-1 rounded-md border border-line-strong bg-bg px-3 py-1.5 text-xs"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="flex-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition disabled:opacity-60"
        >
          {pending ? "…" : isOnline ? "Save" : "Save Offline"}
        </button>
      </div>
    </div>
  );
}
