"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPurchaseOrderAction, type PurchaseOrderLineInput } from "@/app/actions/purchaseOrders";
import { QuotationLineEditor, blankLine, type EditableLine , type LineItem} from "@/components/QuotationLineEditor";
import { useItemCatalog } from "@/lib/useItemCatalog";
import type { Tables } from "@/lib/supabase/database.types";
import { useOfflineQueue } from "@/components/OfflineQueueProvider";
import { SearchablePicker, PARTY_SOURCE, type PickerFilter, type PickerOption } from "@/components/SearchablePicker";

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
  direct: "Buying directly for a client order — this won't go into stock, it will be delivered straight to the client (Material Supply).",
  stock: "Will go into warehouse stock — raw material or stocked trading goods.",
  general: "Office/miscellaneous expense — not linked to stock or any client order.",
};

type SalesOrderOption = Pick<Tables<"sales_orders">, "id" | "so_no" | "client_po_number"> & {
  parties: { legal_name: string } | null;
};

// Mirrors this page's own `.eq("is_active", true).in("party_type", [...])`
// exactly, expressed so the database keeps applying it as the user types.
const SUPPLIER_FILTERS: PickerFilter[] = [
  { column: "is_active", op: "eq", value: true },
  { column: "party_type", op: "in", value: ["supplier", "both"] },
];

export function NewPurchaseOrderForm({
  suppliers,
  salesOrders,
  warehouses,
  items: itemsProp,
  units,
}: {
  // Only a first page of suppliers — the rest are found by typing, searched
  // in the database rather than shipped to the browser. See SearchablePicker.
  suppliers: Pick<Tables<"parties">, "id" | "legal_name">[];
  salesOrders: SalesOrderOption[];
  warehouses: Tables<"warehouses">[];
  // A first page of items plus those already referenced here — the rest
  // are found by typing, searched in the database. See SearchablePicker.
  items: LineItem[];
  units: Tables<"units">[];
}) {
  // The form works from this list, not the raw prop: every item picked by
  // searching is merged in, so the lookups below keep resolving. See
  // useItemCatalog.
  const { items, addItem } = useItemCatalog(itemsProp);
  const router = useRouter();
  const [supplierId, setSupplierId] = useState("");
  const supplierOptions: PickerOption[] = suppliers.map((s) => ({ id: s.id, label: s.legal_name }));
  const [purchaseType, setPurchaseType] = useState<"direct" | "stock" | "general">("stock");
  const [linkedSoId, setLinkedSoId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [expectedDelivery, setExpectedDelivery] = useState("");
  const [lines, setLines] = useState<EditableLine[]>([blankLine(0)]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { isOnline, enqueue } = useOfflineQueue();
  const [savedOffline, setSavedOffline] = useState(false);

  // Phase 3 (Master Offline-First Roadmap): Purchase Order creation is
  // pure document creation (no stock posting yet — that happens at GRN),
  // so like Quotation/Sales Order it's genuinely low-risk offline. NOTE:
  // this is only reachable offline if the linked Sales Order (for a
  // "direct" purchase) already exists server-side — see this form's own
  // RPC entry in offlineQueue.ts.
  function submit() {
    setError(null);
    if (!supplierId) {
      setError("Select Supplier.");
      return;
    }
    if (purchaseType === "direct" && !linkedSoId) {
      setError("A direct purchase must be linked to a Sales Order.");
      return;
    }
    if (purchaseType === "stock" && !warehouseId) {
      setError("Select a warehouse for stock purchase.");
      return;
    }

    if (!isOnline) {
      startTransition(async () => {
        await enqueue({
          kind: "create",
          table: "purchase_orders",
          recordId: crypto.randomUUID(),
          label: "Purchase Order",
          payload: {
            supplier_id: supplierId,
            purchase_type: purchaseType,
            linked_sales_order_id: purchaseType === "direct" ? linkedSoId : null,
            warehouse_id: purchaseType === "stock" ? warehouseId : null,
            expected_delivery: expectedDelivery || null,
            lines: serialize(lines),
          },
        });
        setSavedOffline(true);
      });
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

  if (savedOffline) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 max-w-xl space-y-3">
        <p className="rounded-md bg-good-soft px-3 py-2 text-sm text-good">
          Purchase Order saved on this device — it will get its PO number and sync automatically once you&apos;re
          back online.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface p-5 space-y-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Supplier *</span>
          <SearchablePicker
            name="supplier_id"
            source={PARTY_SOURCE}
            filters={SUPPLIER_FILTERS}
            initialOptions={supplierOptions}
            placeholder="Type a supplier name…"
            onChange={(o) => setSupplierId(o?.id ?? "")}
          />
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

      <QuotationLineEditor items={items} onItemPicked={addItem} units={units} lines={lines} onChange={setLines} />

      {!isOnline && (
        <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
          ⏳ You&apos;re offline — this Purchase Order will be saved on this device and synced automatically once
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
        {pending ? "Saving…" : isOnline ? "Create Purchase Order" : "Save Offline"}
      </button>
    </div>
  );
}
