"use client";

import { useState, useTransition } from "react";
import { quickCreateItemAction } from "@/app/actions/items";
import { SearchablePicker, ITEM_SOURCE, ACTIVE_ONLY, type PickerOption } from "@/components/SearchablePicker";
import { useOfflineQueue } from "@/components/OfflineQueueProvider";
import type { Tables } from "@/lib/supabase/database.types";

/**
 * Shown on the Receive Goods (GRN) screen for a PO line that has no Item
 * yet (see QuotationLineEditor's "Item (optional)" column — a Purchase
 * Order line can be created without one). Lets the store person either
 * pick an existing Item or create a new one right here, so receiving
 * doesn't need a trip to the Items page and back. The picked/created
 * item_id is reported up to ReceiveGrnPanel, which sends it along with
 * this GRN — the server backfills it onto the PO line (see
 * fn_create_grn's own handling, Phase 46.03).
 */
export function GrnItemAssigner({
  units,
  initialOptions,
  onAssign,
}: {
  units: Tables<"units">[];
  initialOptions: PickerOption[];
  onAssign: (itemId: string, label: string) => void;
}) {
  const { isOnline } = useOfflineQueue();
  const [creating, setCreating] = useState(false);
  const [itemCode, setItemCode] = useState("");
  const [description, setDescription] = useState("");
  const [baseUnit, setBaseUnit] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function createNew() {
    setError(null);
    if (!itemCode.trim() || !description.trim() || !baseUnit) {
      setError("Code, description and unit are required.");
      return;
    }
    startTransition(async () => {
      const res = await quickCreateItemAction({ item_code: itemCode.trim(), description: description.trim(), base_unit: baseUnit });
      if (res.error || !res.id) {
        setError(res.error ?? "Could not create the Item.");
        return;
      }
      onAssign(res.id, itemCode.trim());
    });
  }

  if (creating) {
    return (
      <div className="space-y-1.5 rounded-md border border-line bg-bg p-2">
        <div className="grid grid-cols-3 gap-1.5">
          <input value={itemCode} onChange={(e) => setItemCode(e.target.value)} placeholder="Item Code" className="input !py-1 text-xs" />
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" className="input !py-1 text-xs col-span-2" />
        </div>
        <select value={baseUnit} onChange={(e) => setBaseUnit(e.target.value)} className="input !py-1 text-xs">
          <option value="">— Unit —</option>
          {units.map((u) => (
            <option key={u.code} value={u.code}>
              {u.code}
            </option>
          ))}
        </select>
        {error && <p className="text-[11px] text-bad">{error}</p>}
        <div className="flex gap-1.5">
          <button type="button" onClick={createNew} disabled={pending} className="rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-60">
            {pending ? "…" : "Save Item"}
          </button>
          <button type="button" onClick={() => setCreating(false)} className="rounded-md border border-line bg-surface px-2 py-1 text-[11px] text-ink-soft hover:bg-surface-2">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <SearchablePicker
        name="grn_new_item"
        source={ITEM_SOURCE}
        filters={ACTIVE_ONLY}
        initialOptions={initialOptions}
        placeholder="Pick an Item…"
        onChange={(o) => o && onAssign(o.id, o.label)}
      />
      {isOnline && (
        <button type="button" onClick={() => setCreating(true)} className="text-[11px] text-accent-ink underline underline-offset-2">
          + Add New Item
        </button>
      )}
    </div>
  );
}
