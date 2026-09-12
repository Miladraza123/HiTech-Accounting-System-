"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestStockAdjustmentAction } from "@/app/actions/inventory";
import type { Tables } from "@/lib/supabase/database.types";

export function StockAdjustmentRequestForm({
  items,
  warehouses,
}: {
  items: Tables<"items">[];
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

  function submit() {
    setError(null);
    setOk(false);
    const delta = Number(qtyDelta);
    if (!itemId || !warehouseId || !delta || !reason.trim()) {
      setError("All fields are required — enter a negative number if the count is lower, positive if it's higher.");
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
        <select value={itemId} onChange={(e) => setItemId(e.target.value)} className="input">
          <option value="">— Item —</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.item_code} — {i.description}
            </option>
          ))}
        </select>
        <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="input">
          <option value="">— Warehouse —</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
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

      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      {ok && <p className="rounded-md bg-good-soft px-3 py-2 text-sm text-good">Request sent — waiting for Owner approval.</p>}

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "…" : "Send Request"}
      </button>
    </div>
  );
}
