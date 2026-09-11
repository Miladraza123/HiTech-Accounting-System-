"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPurchaseOrderAction, type PurchaseOrderLineInput } from "@/app/actions/purchaseOrders";
import { QuotationLineEditor, blankLine, type EditableLine } from "@/components/QuotationLineEditor";
import type { Tables } from "@/lib/supabase/database.types";

function serialize(lines: EditableLine[]): PurchaseOrderLineInput[] {
  return lines
    .filter((l) => l.description.trim())
    .map((l) => ({
      item_id: l.item_id || undefined,
      description: l.description,
      ordered_qty: Number(l.qty) || 0,
      unit: l.unit || undefined,
      rate: Number(l.rate) || 0,
      tax_pct: Number(l.tax_pct) || 0,
    }));
}

const PURCHASE_TYPE_INFO: Record<string, string> = {
  direct: "Kisi client order ke liye seedha khareed rahe hain — stock mein nahi jayega, seedha client ko deliver hoga (Material Supply).",
  stock: "Warehouse stock mein jayega — raw material ya stocked trading goods.",
  general: "Office/misc kharch — na stock mein, na kisi client order se juda.",
};

type SalesOrderOption = Pick<Tables<"sales_orders">, "id" | "so_no" | "client_po_number"> & {
  parties: { legal_name: string } | null;
};

export function NewPurchaseOrderForm({
  suppliers,
  salesOrders,
  warehouses,
  items,
  units,
}: {
  suppliers: Tables<"parties">[];
  salesOrders: SalesOrderOption[];
  warehouses: Tables<"warehouses">[];
  items: Tables<"items">[];
  units: Tables<"units">[];
}) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState("");
  const [purchaseType, setPurchaseType] = useState<"direct" | "stock" | "general">("stock");
  const [linkedSoId, setLinkedSoId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [expectedDelivery, setExpectedDelivery] = useState("");
  const [lines, setLines] = useState<EditableLine[]>([blankLine(0)]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    if (!supplierId) {
      setError("Supplier select karen.");
      return;
    }
    if (purchaseType === "direct" && !linkedSoId) {
      setError("Direct purchase kisi Sales Order se link honi chahiye.");
      return;
    }
    if (purchaseType === "stock" && !warehouseId) {
      setError("Stock purchase ke liye warehouse select karen.");
      return;
    }
    startTransition(async () => {
      const res = await createPurchaseOrderAction({
        supplier_id: supplierId,
        purchase_type: purchaseType,
        linked_sales_order_id: purchaseType === "direct" ? linkedSoId : null,
        warehouse_id: purchaseType === "stock" ? warehouseId : null,
        expected_delivery: expectedDelivery || null,
        lines: serialize(lines),
      });
      if (res.error) setError(res.error);
      else router.push(`/purchase-orders/${res.id}`);
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface p-5 space-y-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Supplier *</span>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="input">
            <option value="">— Select —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.legal_name}
              </option>
            ))}
          </select>
        </label>

        <div className="space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Purchase Type *</span>
          <div className="grid grid-cols-3 gap-2">
            {(["stock", "direct", "general"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setPurchaseType(t)}
                className={`rounded-md border px-3 py-2 text-sm text-left transition ${
                  purchaseType === t ? "border-accent bg-accent-soft/40 text-ink" : "border-line bg-bg text-ink-soft hover:bg-surface-2"
                }`}
              >
                <span className="block font-medium capitalize">{t === "stock" ? "Stock" : t === "direct" ? "Direct (Client Order)" : "General"}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-faint">{PURCHASE_TYPE_INFO[purchaseType]}</p>
        </div>

        {purchaseType === "direct" && (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Sales Order (Client Order) *</span>
            <select value={linkedSoId} onChange={(e) => setLinkedSoId(e.target.value)} className="input">
              <option value="">— Select —</option>
              {salesOrders.map((so) => (
                <option key={so.id} value={so.id}>
                  {so.so_no} — {so.parties?.legal_name} (PO: {so.client_po_number})
                </option>
              ))}
            </select>
          </label>
        )}

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

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Expected Delivery</span>
          <input type="date" value={expectedDelivery} onChange={(e) => setExpectedDelivery(e.target.value)} className="input" />
        </label>
      </div>

      <QuotationLineEditor items={items} units={units} lines={lines} onChange={setLines} />

      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Save ho raha hai…" : "Purchase Order Banayen"}
      </button>
    </div>
  );
}
