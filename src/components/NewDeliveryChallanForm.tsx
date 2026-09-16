"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDeliveryChallanAction, type DeliveryChallanLineInput } from "@/app/actions/deliveryChallans";
import { type LineItem } from "@/components/QuotationLineEditor";
import type { Tables } from "@/lib/supabase/database.types";
import { useOfflineQueue } from "@/components/OfflineQueueProvider";

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


export function NewDeliveryChallanForm({
  salesOrders,
  warehouses,
  items,
}: {
  salesOrders: SoOption[];
  warehouses: Tables<"warehouses">[];
  // Only the items this screen's own delivered lines reference — there is
  // no item dropdown here, so the whole catalogue was never needed. See
  // fetchItemsByIds.
  items: LineItem[];
}) {
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
  const { isOnline, enqueue } = useOfflineQueue();
  const [savedOffline, setSavedOffline] = useState(false);

  const so = salesOrders.find((s) => s.id === soId);

  function submit() {
    setError(null);
    if (!soId) {
      setError("Select Sales Order.");
      return;
    }
    if (!warehouseId) {
      setError("Select Warehouse.");
      return;
    }
    const candidateLines = (so?.lines ?? []).filter((l) => Number(qtys[l.id] ?? 0) > 0);
    if (!candidateLines.length) {
      setError("Enter delivered qty in at least one line.");
      return;
    }

    const lines: DeliveryChallanLineInput[] = [];
    for (const l of candidateLines) {
      const deliveredQty = Number(qtys[l.id] ?? 0);
      const issue = !!issueFlags[l.id];
      let stockQty: number | undefined;
      if (issue) {
        const item = items.find((i) => i.id === l.item_id);
        if (!item) {
          setError(`Item for "${l.description}" not found — cannot issue from stock.`);
          return;
        }
        if (!l.unit || l.unit === item.base_unit) {
          stockQty = deliveredQty;
        } else {
          // Conversions ride on the item itself — see LineItem.
              const alt = (item.item_alt_units ?? []).find((a) => a.unit === l.unit && a.is_active);
          if (!alt) {
            setError(
              `No conversion factor is set from "${l.description}"'s unit (${l.unit}) to this item's base unit (${item.base_unit}) — add "Alternate Units" in the Item Master, or uncheck "Issue from Stock".`
            );
            return;
          }
          stockQty = Math.round(deliveredQty * alt.factor * 1000) / 1000;
        }
      }
      lines.push({
        sales_order_line_id: l.id,
        delivered_qty: deliveredQty,
        issue_from_stock: issue,
        stock_qty: stockQty,
      });
    }
    // Phase 4 (Master Offline-First Roadmap): Delivery Challan is the
    // app's first offline create that DEDUCTS stock — see this form's own
    // RPC entry in offlineQueue.ts for why that's still safe: the
    // server-side RPC re-validates both "not more than ordered" and "not
    // more than physical stock on hand" against the TRUE, live state at
    // sync time, never trusting what this offline device last saw.
    if (!isOnline) {
      startTransition(async () => {
        await enqueue({
          kind: "create",
          table: "delivery_challans",
          recordId: crypto.randomUUID(),
          label: "Delivery Challan",
          payload: {
            sales_order_id: soId,
            warehouse_id: warehouseId,
            delivery_date: deliveryDate,
            vehicle_no: vehicleNo || null,
            driver_name: driverName || null,
            remarks: remarks || null,
            lines,
          },
        });
        setSavedOffline(true);
      });
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

  if (savedOffline) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 max-w-xl space-y-3">
        <p className="rounded-md bg-good-soft px-3 py-2 text-sm text-good">
          Delivery Challan saved on this device — it will get its DC number, deduct stock, and sync automatically
          once you&apos;re back online. If the stock this device saw is no longer available by then, the sync will
          fail with a clear reason instead of allowing stock to go negative.
        </p>
      </div>
    );
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
                  <th className="text-right px-3 py-2 w-32 min-w-[8rem]">This Delivery</th>
                  <th className="text-center px-3 py-2 w-36">Issue from Stock?</th>
                </tr>
              </thead>
              <tbody>
                {so.lines.map((l) => {
                  const item = items.find((i) => i.id === l.item_id);
                  const deliveredQty = Number(qtys[l.id] ?? 0);
                  const needsConversion = !!item && !!l.unit && l.unit !== item.base_unit;
                  const alt = needsConversion ? (item!.item_alt_units ?? []).find((a) => a.unit === l.unit && a.is_active) : undefined;
                  const conversionMissing = needsConversion && !alt;
                  return (
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
                        {issueFlags[l.id] && alt && deliveredQty > 0 && (
                          <p className="text-[10px] text-ink-faint text-right mt-0.5 tabular">
                            = {(Math.round(deliveredQty * alt.factor * 1000) / 1000).toFixed(3)} {item?.base_unit} stock
                          </p>
                        )}
                        {issueFlags[l.id] && conversionMissing && (
                          <p className="text-[10px] text-bad text-right mt-0.5">
                            {l.unit}→{item?.base_unit} conversion missing
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <input
                          type="checkbox"
                          disabled={!l.item_id}
                          checked={!!issueFlags[l.id]}
                          onChange={(e) => setIssueFlags((f) => ({ ...f, [l.id]: e.target.checked }))}
                          title={!l.item_id ? "This line has no item" : "Quantity will be deducted from warehouse stock"}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="px-3 py-2 text-xs text-ink-faint border-t border-line">
            Only check &quot;Issue from Stock&quot; when this material is already sitting in warehouse stock (received via GRN). If it went directly from a
            Direct Purchase to the client, or is Fabrication finished output, leave it unchecked — its cost has already been booked.
          </p>
        </div>
      )}

      {!isOnline && (
        <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
          ⏳ You&apos;re offline — this Delivery Challan will be saved on this device and synced automatically once
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
        {pending ? "Saving…" : isOnline ? "Create Delivery Challan" : "Save Offline"}
      </button>
    </div>
  );
}
