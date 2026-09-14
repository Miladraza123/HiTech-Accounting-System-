"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createStockTransferAction } from "@/app/actions/stockTransfers";
import type { Tables } from "@/lib/supabase/database.types";
import { useOfflineQueue } from "@/components/OfflineQueueProvider";

type Line = { item_id: string; qty: string };

export function NewStockTransferForm({ warehouses, items }: { warehouses: Tables<"warehouses">[]; items: Tables<"items">[] }) {
  const router = useRouter();
  const [fromWarehouseId, setFromWarehouseId] = useState("");
  const [toWarehouseId, setToWarehouseId] = useState("");
  const [transferDate, setTransferDate] = useState(new Date().toISOString().slice(0, 10));
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<Line[]>([{ item_id: "", qty: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { isOnline, enqueue } = useOfflineQueue();
  const [savedOffline, setSavedOffline] = useState(false);

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((ls) => [...ls, { item_id: "", qty: "" }]);
  }
  function removeLine(i: number) {
    setLines((ls) => ls.filter((_, idx) => idx !== i));
  }

  function submit() {
    setError(null);
    if (!fromWarehouseId || !toWarehouseId) {
      setError("Select From and To warehouse.");
      return;
    }
    if (fromWarehouseId === toWarehouseId) {
      setError("From and To warehouse must be different.");
      return;
    }
    const cleanLines = lines
      .filter((l) => l.item_id && Number(l.qty) > 0)
      .map((l) => ({ item_id: l.item_id, qty: Number(l.qty) }));
    if (!cleanLines.length) {
      setError("Enter at least one item and quantity.");
      return;
    }

    // Phase 6 (Master Offline-First Roadmap): already atomic across both
    // warehouses even offline (see this form's own RPC entry in
    // offlineQueue.ts) — a rejected "out" leg (insufficient stock,
    // re-checked live at sync time) rolls back the "in" leg too.
    if (!isOnline) {
      startTransition(async () => {
        await enqueue({
          kind: "create",
          table: "stock_transfers",
          recordId: crypto.randomUUID(),
          label: "Stock Transfer",
          payload: { from_warehouse_id: fromWarehouseId, to_warehouse_id: toWarehouseId, transfer_date: transferDate, remarks: remarks || null, lines: cleanLines },
        });
        setSavedOffline(true);
      });
      return;
    }

    startTransition(async () => {
      const res = await createStockTransferAction({
        from_warehouse_id: fromWarehouseId,
        to_warehouse_id: toWarehouseId,
        transfer_date: transferDate,
        remarks: remarks || null,
        lines: cleanLines,
      });
      if (res.error) setError(res.error);
      else router.push(`/stock-transfers/${res.id}`);
    });
  }

  if (savedOffline) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 max-w-xl space-y-3">
        <p className="rounded-md bg-good-soft px-3 py-2 text-sm text-good">
          Stock Transfer saved on this device — it will get its Transfer number and sync automatically once
          you&apos;re back online.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">From Warehouse *</span>
          <select value={fromWarehouseId} onChange={(e) => setFromWarehouseId(e.target.value)} className="input">
            <option value="">— Select —</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">To Warehouse *</span>
          <select value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value)} className="input">
            <option value="">— Select —</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Transfer Date</span>
          <input type="date" value={transferDate} onChange={(e) => setTransferDate(e.target.value)} className="input" />
        </label>
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-3 py-2">Item</th>
                <th className="text-right px-3 py-2 w-32 min-w-[8rem]">Qty</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="px-2 py-1.5">
                    <select value={l.item_id} onChange={(e) => updateLine(i, { item_id: e.target.value })} className="input !py-1 text-xs">
                      <option value="">— Select Item —</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.item_code} — {it.description}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      value={l.qty}
                      onChange={(e) => updateLine(i, { qty: e.target.value })}
                      className="input !py-1 text-xs text-right tabular"
                      placeholder="0"
                    />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {lines.length > 1 && (
                      <button type="button" onClick={() => removeLine(i)} className="text-ink-faint hover:text-bad text-xs">
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-3 py-2 border-t border-line">
          <button type="button" onClick={addLine} className="text-xs text-accent-ink hover:underline">
            + Add Item
          </button>
        </div>
      </div>

      <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} placeholder="Remarks (optional)" className="input resize-none" />

      {!isOnline && (
        <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
          ⏳ You&apos;re offline — this Stock Transfer will be saved on this device and synced automatically once
          you&apos;re back online.
        </p>
      )}

      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Saving…" : isOnline ? "Create Stock Transfer" : "Save Offline"}
      </button>
    </div>
  );
}
