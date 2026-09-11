"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDeliveryChallanAction, type DeliveryChallanLineInput } from "@/app/actions/deliveryChallans";
import type { Tables } from "@/lib/supabase/database.types";

type SoLine = {
  id: string;
  description: string;
  ordered_qty: number;
  delivered_qty: number;
  unit: string | null;
  item_id: string | null;
};
type SoOption = {
  id: string;
  so_no: string;
  business_line: string;
  parties: { legal_name: string } | null;
  lines: SoLine[];
};

export function NewDeliveryChallanForm({ salesOrders, warehouses }: { salesOrders: SoOption[]; warehouses: Tables<"warehouses">[] }) {
  const router = useRouter();
  const [soId, setSoId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(new Date().toISOString().slice(0, 10));
  const [vehicleNo, setVehicleNo] = useState("");
  const [driverName, setDriverName] = useState("");
  const [remarks, setRemarks] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [issueFlags, setIssueFlags] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const so = salesOrders.find((s) => s.id === soId);

  function submit() {
    setError(null);
    if (!soId) {
      setError("Sales Order select karen.");
      return;
    }
    if (!warehouseId) {
      setError("Warehouse select karen.");
      return;
    }
    const lines: DeliveryChallanLineInput[] = (so?.lines ?? [])
      .map((l) => ({
        sales_order_line_id: l.id,
        delivered_qty: Number(qtys[l.id] ?? 0),
        issue_from_stock: !!issueFlags[l.id],
      }))
      .filter((l) => l.delivered_qty > 0);
    if (!lines.length) {
      setError("Kam az kam ek line mein delivered qty likhen.");
      return;
    }
    startTransition(async () => {
      const res = await createDeliveryChallanAction({
        sales_order_id: soId,
        warehouse_id: warehouseId,
        delivery_date: deliveryDate,
        vehicle_no: vehicleNo || null,
        driver_name: driverName || null,
        remarks: remarks || null,
        lines,
      });
      if (res.error) setError(res.error);
      else router.push(`/delivery-challans/${res.id}`);
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface p-5 space-y-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Sales Order *</span>
          <select value={soId} onChange={(e) => setSoId(e.target.value)} className="input">
            <option value="">— Select —</option>
            {salesOrders.map((s) => (
              <option key={s.id} value={s.id}>
                {s.so_no} — {s.parties?.legal_name}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Delivery Date</span>
            <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className="input" />
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Vehicle No</span>
            <input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} className="input" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Driver Name</span>
            <input value={driverName} onChange={(e) => setDriverName(e.target.value)} className="input" />
          </label>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Remarks</span>
          <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} className="input resize-none" />
        </label>
      </div>

      {so && (
        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="text-left px-3 py-2">Description</th>
                  <th className="text-right px-3 py-2">Ordered</th>
                  <th className="text-right px-3 py-2">Delivered so far</th>
                  <th className="text-right px-3 py-2">Pending</th>
                  <th className="text-right px-3 py-2 w-32">This Delivery</th>
                  <th className="text-center px-3 py-2 w-36">Issue from Stock?</th>
                </tr>
              </thead>
              <tbody>
                {so.lines.map((l) => (
                  <tr key={l.id} className="border-t border-line">
                    <td className="px-3 py-2 text-ink">{l.description}</td>
                    <td className="px-3 py-2 text-right tabular text-ink-soft">{l.ordered_qty}</td>
                    <td className="px-3 py-2 text-right tabular text-ink-soft">{l.delivered_qty}</td>
                    <td className="px-3 py-2 text-right tabular text-ink-soft">{(l.ordered_qty - l.delivered_qty).toFixed(3)}</td>
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
                    <td className="px-3 py-1.5 text-center">
                      <input
                        type="checkbox"
                        disabled={!l.item_id}
                        checked={!!issueFlags[l.id]}
                        onChange={(e) => setIssueFlags((f) => ({ ...f, [l.id]: e.target.checked }))}
                        title={!l.item_id ? "Is line ka item nahi hai" : "Warehouse stock se qty kam ho jayegi"}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-3 py-2 text-xs text-ink-faint border-t border-line">
            &quot;Issue from Stock&quot; sirf tab check karen jab yeh material pehle se warehouse stock mein para ho (GRN se aaya ho). Agar yeh Direct
            Purchase se seedha client ko gaya tha, ya Fabrication ka finished output hai, to unchecked rehne den — uska cost pehle hi book ho chuka hai.
          </p>
        </div>
      )}

      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Save ho raha hai…" : "Delivery Challan Banayen"}
      </button>
    </div>
  );
}
