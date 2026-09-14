"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createGrnAction } from "@/app/actions/purchaseOrders";
import type { Tables } from "@/lib/supabase/database.types";
import { useOfflineQueue } from "@/components/OfflineQueueProvider";

export function ReceiveGrnPanel({
  supplierId,
  purchaseOrderId,
  purchaseType,
  defaultWarehouseId,
  warehouses,
  lines,
}: {
  supplierId: string;
  purchaseOrderId: string;
  purchaseType: string;
  defaultWarehouseId: string | null;
  warehouses: Tables<"warehouses">[];
  lines: Tables<"purchase_order_lines">[];
}) {
  const router = useRouter();
  const pendingLines = lines.filter((l) => l.received_qty < l.ordered_qty);
  const [open, setOpen] = useState(false);
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10));
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId ?? "");
  const [remarks, setRemarks] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { isOnline, enqueue } = useOfflineQueue();
  const [savedOffline, setSavedOffline] = useState(false);

  if (!pendingLines.length && !savedOffline) return null;

  // Phase 3 (Master Offline-First Roadmap): GRN is the app's first
  // stock-AND-accounting-posting offline create — see this form's own RPC
  // entry in offlineQueue.ts for why it's still safe: the server-side RPC
  // always re-reads the true, current `received_qty` at sync time rather
  // than trusting anything this offline device remembers.
  if (savedOffline) {
    return (
      <div className="rounded-xl border border-line bg-surface p-5">
        <p className="rounded-md bg-good-soft px-3 py-2 text-sm text-good">
          GRN saved on this device — it will get its GRN number, post to stock, and sync automatically once
          you&apos;re back online.
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition"
      >
        Receive Goods (GRN)
      </button>
    );
  }

  function submit() {
    setError(null);
    const grnLines = pendingLines
      .map((l) => ({ po_line_id: l.id, this_receipt_qty: Number(qtys[l.id] ?? 0) }))
      .filter((l) => l.this_receipt_qty > 0);

    if (!grnLines.length) {
      setError("Enter qty in at least one line.");
      return;
    }
    if (purchaseType === "stock" && !warehouseId) {
      setError("Select Warehouse.");
      return;
    }

    if (!isOnline) {
      startTransition(async () => {
        await enqueue({
          kind: "create",
          table: "grns",
          recordId: crypto.randomUUID(),
          label: "GRN",
          payload: {
            supplier_id: supplierId,
            purchase_order_id: purchaseOrderId,
            received_date: receivedDate,
            warehouse_id: purchaseType === "stock" ? warehouseId : null,
            remarks: remarks || null,
            lines: grnLines,
          },
        });
        setOpen(false);
        setQtys({});
        setSavedOffline(true);
      });
      return;
    }

    startTransition(async () => {
      const res = await createGrnAction({
        supplier_id: supplierId,
        purchase_order_id: purchaseOrderId,
        received_date: receivedDate,
        warehouse_id: purchaseType === "stock" ? warehouseId : null,
        remarks: remarks || null,
        lines: grnLines,
      });
      if (res.error) setError(res.error);
      else {
        setOpen(false);
        setQtys({});
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4 rounded-xl border border-accent bg-accent-soft/30 p-5">
      <p className="text-sm font-medium text-ink">Receive Goods — enter the quantity actually received, not the ordered qty.</p>

      <div className="grid grid-cols-2 gap-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Received Date</span>
          <input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} className="input" />
        </label>
        {purchaseType === "stock" && (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Warehouse *</span>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="input">
              <option value="">— Select —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-3 py-2">Description</th>
                <th className="text-right px-3 py-2">Ordered</th>
                <th className="text-right px-3 py-2">Received so far</th>
                <th className="text-right px-3 py-2">Pending</th>
                <th className="text-right px-3 py-2 w-32 min-w-[8rem]">This Receipt</th>
              </tr>
            </thead>
            <tbody>
              {pendingLines.map((l) => (
                <tr key={l.id} className="border-t border-line">
                  <td className="px-3 py-2 text-ink">{l.description}</td>
                  <td className="px-3 py-2 text-right tabular text-ink-soft">{l.ordered_qty}</td>
                  <td className="px-3 py-2 text-right tabular text-ink-soft">{l.received_qty}</td>
                  <td className="px-3 py-2 text-right tabular text-ink-soft">{(l.ordered_qty - l.received_qty).toFixed(3)}</td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      value={qtys[l.id] ?? ""}
                      onChange={(e) => setQtys((q) => ({ ...q, [l.id]: e.target.value }))}
                      className="input !py-1 text-xs text-right tabular"
                      placeholder="0"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} placeholder="Remarks (optional)" className="input resize-none" />

      {!isOnline && (
        <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
          ⏳ You&apos;re offline — this GRN will be saved on this device and synced automatically once you&apos;re
          back online.
        </p>
      )}

      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}

      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-line-strong bg-bg px-4 py-2 text-sm text-ink hover:bg-surface-2 transition">
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
        >
          {pending ? "…" : isOnline ? "Save GRN" : "Save Offline"}
        </button>
      </div>
    </div>
  );
}
