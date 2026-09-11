"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createGrnAction } from "@/app/actions/purchaseOrders";
import type { Tables } from "@/lib/supabase/database.types";

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

  if (!pendingLines.length) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition"
      >
        Goods Receive Karen (GRN)
      </button>
    );
  }

  function submit() {
    setError(null);
    const grnLines = pendingLines
      .map((l) => ({ po_line_id: l.id, this_receipt_qty: Number(qtys[l.id] ?? 0) }))
      .filter((l) => l.this_receipt_qty > 0);

    if (!grnLines.length) {
      setError("Kam az kam ek line mein qty likhen.");
      return;
    }
    if (purchaseType === "stock" && !warehouseId) {
      setError("Warehouse select karen.");
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
      <p className="text-sm font-medium text-ink">Goods Receive Karen — jitna asal mein aaya wahi likhen, order qty nahi.</p>

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
                <th className="text-right px-3 py-2 w-32">This Receipt</th>
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
          {pending ? "…" : "GRN Save Karen"}
        </button>
      </div>
    </div>
  );
}
