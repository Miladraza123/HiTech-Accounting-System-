"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestStockAdjustmentAction } from "@/app/actions/inventory";
import type { Tables } from "@/lib/supabase/database.types";
import { useOfflineQueue } from "@/components/OfflineQueueProvider";
import { getPendingCreateOptions, type PendingCreateOption } from "@/lib/offlineQueue";
import { SearchablePicker, ITEM_SOURCE, ACTIVE_ONLY, type PickerOption } from "@/components/SearchablePicker";
import { type LineItem } from "@/components/QuotationLineEditor";

export function StockAdjustmentRequestForm({
  items,
  warehouses,
}: {
  // A first page of items only — the rest are found by typing, searched in
  // the database rather than shipped to the browser. See SearchablePicker.
  items: LineItem[];
  warehouses: Tables<"warehouses">[];
}) {
  const router = useRouter();
  const [itemId, setItemId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [qtyDelta, setQtyDelta] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();
  const { isOnline, enqueue } = useOfflineQueue();
  const [savedOffline, setSavedOffline] = useState(false);

  // Phase 9 (Master Offline-First Roadmap): an Item/Warehouse created
  // offline is otherwise invisible in these dropdowns until it syncs —
  // merged in here as extra options; picking one threads a `dependsOn`
  // entry so this request only ever syncs after its Item/Warehouse has
  // (see offlineQueue.ts).
  const [pendingItems, setPendingItems] = useState<PendingCreateOption[]>([]);
  const [pendingWarehouses, setPendingWarehouses] = useState<PendingCreateOption[]>([]);
  useEffect(() => {
    getPendingCreateOptions("items").then(setPendingItems);
    getPendingCreateOptions("warehouses").then(setPendingWarehouses);
  }, []);

  const itemOptions: PickerOption[] = items.map((i) => ({ id: i.id, label: i.item_code, hint: i.description }));
  const pendingItemOptions: PickerOption[] = pendingItems.map((i) => ({
    id: i.id,
    label: String(i.payload.item_code ?? i.label),
  }));

  // Phase 6 (Master Offline-First Roadmap): offline-enables only the
  // REQUEST step — a plain pending-row insert with no stock/accounting
  // impact at all (approval stays a distinct, Owner-only, always-online
  // review action). See this form's own RPC entry in offlineQueue.ts.
  function submit() {
    setError(null);
    setOk(false);
    const delta = Number(qtyDelta);
    if (!itemId || !warehouseId || !delta || !reason.trim()) {
      setError("All fields are required — enter a negative number if the count is lower, positive if it's higher.");
      return;
    }

    if (!isOnline) {
      startTransition(async () => {
        const pendingItem = pendingItems.find((i) => i.id === itemId);
        const pendingWarehouse = pendingWarehouses.find((w) => w.id === warehouseId);
        const dependsOn = [
          ...(pendingItem ? [{ queuedId: pendingItem.queuedId, field: "item_id" }] : []),
          ...(pendingWarehouse ? [{ queuedId: pendingWarehouse.queuedId, field: "warehouse_id" }] : []),
        ];
        await enqueue({
          kind: "create",
          table: "stock_adjustments",
          recordId: crypto.randomUUID(),
          label: "Stock Adjustment Request",
          payload: { item_id: itemId, warehouse_id: warehouseId, qty_delta: delta, reason },
          ...(dependsOn.length ? { dependsOn } : {}),
        });
        setItemId("");
        setWarehouseId("");
        setQtyDelta("");
        setReason("");
        setSavedOffline(true);
      });
      return;
    }

    startTransition(async () => {
      const res = await requestStockAdjustmentAction(itemId, warehouseId, delta, reason);
      if (res.error) setError(res.error);
      else {
        setOk(true);
        setItemId("");
        setWarehouseId("");
        setQtyDelta("");
        setReason("");
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-5 space-y-3">
      <p className="text-sm font-medium text-ink">Request Physical Count Adjustment</p>
      <p className="text-xs text-ink-faint">
        This does not change stock directly — both stock and accounts will only be updated once the Owner approves it.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <SearchablePicker
          name="adjustment_item_id"
          source={ITEM_SOURCE}
          filters={ACTIVE_ONLY}
          initialOptions={itemOptions}
          pendingOptions={pendingItemOptions}
          placeholder="Type an item code…"
          onChange={(o) => setItemId(o?.id ?? "")}
        />
        <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="input">
          <option value="">— Warehouse —</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
          {pendingWarehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {String(w.payload.name ?? w.label)} (offline — pending sync)
            </option>
          ))}
        </select>
      </div>
      <input
        type="number"
        step="0.001"
        value={qtyDelta}
        onChange={(e) => setQtyDelta(e.target.value)}
        placeholder="Qty difference (-5 if lower, +5 if higher)"
        className="input"
      />
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason (refer to the physical count)…" className="input resize-none" />

      {!isOnline && (
        <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
          ⏳ You&apos;re offline — this request will be saved on this device and synced automatically once you&apos;re
          back online.
        </p>
      )}
      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      {ok && <p className="rounded-md bg-good-soft px-3 py-2 text-sm text-good">Request sent — waiting for Owner approval.</p>}
      {savedOffline && <p className="rounded-md bg-good-soft px-3 py-2 text-sm text-good">⏳ Saved offline — waiting to sync.</p>}

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "…" : isOnline ? "Send Request" : "Save Offline"}
      </button>
    </div>
  );
}
