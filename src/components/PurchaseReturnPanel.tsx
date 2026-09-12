"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPurchaseReturnAction } from "@/app/actions/returns";
import type { Tables } from "@/lib/supabase/database.types";

export function PurchaseReturnPanel({
  supplierBillId,
  defaultWarehouseId,
  warehouses,
  lines,
}: {
  supplierBillId: string;
  defaultWarehouseId: string | null;
  warehouses: Tables<"warehouses">[];
  lines: (Tables<"supplier_bill_lines"> & { itemLabel: string })[];
}) {
  const router = useRouter();
  const returnableLines = lines.filter((l) => l.qty - l.returned_qty > 0.001);
  const [open, setOpen] = useState(false);
  const [returnDate, setReturnDate] = useState(new Date().toISOString().slice(0, 10));
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId ?? "");
  const [reason, setReason] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!returnableLines.length) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition"
      >
        Create Purchase Return
      </button>
    );
  }

  function submit() {
    setError(null);
    const returnLines = returnableLines
      .map((l) => ({ supplier_bill_line_id: l.id, qty: Number(qtys[l.id] ?? 0) }))
      .filter((l) => l.qty > 0);

    if (!returnLines.length) {
      setError("Enter return quantity in at least one line.");
      return;
    }
    if (!warehouseId) {
      setError("Select Warehouse (where the stock will be returned from).");
      return;
    }
    if (!reason.trim()) {
      setError("A return reason is required.");
      return;
    }

    startTransition(async () => {
      const res = await createPurchaseReturnAction({
        supplier_bill_id: supplierBillId,
        warehouse_id: warehouseId,
        return_date: returnDate,
        reason: reason.trim(),
        lines: returnLines,
      });
      if (res.error) setError(res.error);
      else {
        setOpen(false);
        setQtys({});
        setReason("");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4 rounded-xl border border-accent bg-accent-soft/30 p-5">
      <p className="text-sm font-medium text-ink">Enter the quantity being returned to the supplier — the debit note will be created at the bill rate.</p>

      <div className="grid grid-cols-2 gap-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Return Date</span>
          <input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} className="input" />
        </label>
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
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-3 py-2">Item</th>
                <th className="text-right px-3 py-2">Billed</th>
                <th className="text-right px-3 py-2">Already Returned</th>
                <th className="text-right px-3 py-2">Max Returnable</th>
                <th className="text-right px-3 py-2 w-32">Return Qty</th>
              </tr>
            </thead>
            <tbody>
              {returnableLines.map((l) => (
                <tr key={l.id} className="border-t border-line">
                  <td className="px-3 py-2 text-ink">{l.itemLabel}</td>
                  <td className="px-3 py-2 text-right tabular text-ink-soft">{l.qty}</td>
                  <td className="px-3 py-2 text-right tabular text-ink-soft">{l.returned_qty}</td>
                  <td className="px-3 py-2 text-right tabular text-ink-soft">{(l.qty - l.returned_qty).toFixed(3)}</td>
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

      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason for return… (e.g. defective, excess qty)" className="input resize-none" />

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
          {pending ? "…" : "Save Purchase Return"}
        </button>
      </div>
    </div>
  );
}
