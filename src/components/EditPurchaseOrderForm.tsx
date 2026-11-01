"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { editPurchaseOrderAction } from "@/app/actions/purchaseOrders";
import { QuotationLineEditor, type EditableLine, type LineItem } from "@/components/QuotationLineEditor";
import { SearchablePicker, PARTY_SOURCE, type PickerFilter, type PickerOption } from "@/components/SearchablePicker";
import { useItemCatalog } from "@/lib/useItemCatalog";
import { serializeEditedLines } from "@/lib/poEdit";
import type { Tables } from "@/lib/supabase/database.types";

const SUPPLIER_FILTERS: PickerFilter[] = [
  { column: "is_active", op: "eq", value: true },
  { column: "party_type", op: "in", value: ["supplier", "both"] },
];

type PoLine = Pick<Tables<"purchase_order_lines">, "id" | "item_id" | "description" | "ordered_qty" | "unit" | "rate" | "tax_pct" | "received_qty">;

export function EditPurchaseOrderForm({
  po,
  lines: dbLines,
  suppliers,
  warehouses,
  items: itemsProp,
  units,
  hasReceipts,
}: {
  po: {
    id: string;
    po_no: string;
    revision_no: number;
    supplier_id: string;
    supplier_name: string;
    purchase_type: string;
    warehouse_id: string | null;
    expected_delivery: string | null;
  };
  lines: PoLine[];
  suppliers: Pick<Tables<"parties">, "id" | "legal_name">[];
  warehouses: Tables<"warehouses">[];
  items: LineItem[];
  units: Tables<"units">[];
  hasReceipts: boolean;
}) {
  const { items, addItem } = useItemCatalog(itemsProp);
  const router = useRouter();
  const [supplierId, setSupplierId] = useState(po.supplier_id);
  const supplierOptions: PickerOption[] = suppliers.map((s) => ({ id: s.id, label: s.legal_name }));
  const [warehouseId, setWarehouseId] = useState(po.warehouse_id ?? "");
  const [expectedDelivery, setExpectedDelivery] = useState(po.expected_delivery ?? "");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<EditableLine[]>(
    dbLines.map((l) => ({
      key: l.id,
      item_id: l.item_id ?? "",
      description: l.description,
      qty: String(l.ordered_qty),
      unit: l.unit ?? "",
      rate: String(l.rate),
      tax_pct: String(l.tax_pct),
    }))
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const received = dbLines.filter((l) => Number(l.received_qty) > 0);

  function submit() {
    setError(null);
    if (!supplierId) {
      setError("Select Supplier.");
      return;
    }
    if (po.purchase_type === "stock" && !warehouseId) {
      setError("Select a warehouse for stock purchase.");
      return;
    }
    const payload = serializeEditedLines(lines);
    if (!payload.length) {
      setError("A Purchase Order needs at least one line.");
      return;
    }
    startTransition(async () => {
      const res = await editPurchaseOrderAction({
        purchase_order_id: po.id,
        expected_revision: po.revision_no,
        supplier_id: supplierId,
        warehouse_id: po.purchase_type === "stock" ? warehouseId : null,
        expected_delivery: expectedDelivery || null,
        reason: reason.trim(),
        lines: payload,
      });
      if (res.error) setError(res.error);
      else {
        router.push(`/purchase-orders/${po.id}`);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface p-4 text-sm text-ink-soft space-y-1.5">
        <p>
          Saving creates <span className="font-medium text-ink">Revision {po.revision_no + 1}</span>. The current version is kept in the
          revision history, with who changed what and when.
        </p>
        {hasReceipts && (
          <p className="text-warn">
            Goods have already been received on this PO, so the <span className="font-medium">supplier and warehouse are locked</span>; received lines keep their
            item, unit, rate and tax, can&apos;t be removed, and their quantity can&apos;t go below what was received. Other lines can be changed freely.
          </p>
        )}
      </div>

      {received.length > 0 && (
        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="bg-surface-2 px-4 py-2 text-xs font-mono uppercase tracking-wide text-ink-faint">Already received</div>
          <ul className="divide-y divide-line text-sm">
            {received.map((l) => (
              <li key={l.id} className="flex items-center justify-between px-4 py-2">
                <span className="text-ink">{l.description}</span>
                <span className="tabular text-ink-soft">
                  received {Number(l.received_qty)} of {Number(l.ordered_qty)} {l.unit} @ {Number(l.rate)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-xl border border-line bg-surface p-5 space-y-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Supplier *</span>
          <SearchablePicker
            name="supplier_id"
            source={PARTY_SOURCE}
            filters={SUPPLIER_FILTERS}
            initialOptions={supplierOptions}
            initialSelected={{ id: po.supplier_id, label: po.supplier_name }}
            placeholder="Type a supplier name…"
            disabled={hasReceipts}
            onChange={(o) => setSupplierId(o?.id ?? "")}
          />
        </label>

        {po.purchase_type === "stock" && (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Warehouse *</span>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} disabled={hasReceipts} className="input">
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

      <QuotationLineEditor items={items} onItemPicked={addItem} units={units} lines={lines} onChange={setLines} defaultTaxPct={0} showPurchaseHistory />

      <label className="block space-y-1.5 max-w-xl">
        <span className="text-xs font-medium text-ink-soft">Reason for this change (shown in the history)</span>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={300}
          placeholder="e.g. Supplier revised the rate / client increased the quantity"
          className="input"
        />
      </label>

      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
        >
          {pending ? "Saving…" : `Save as Revision ${po.revision_no + 1}`}
        </button>
        <button
          type="button"
          onClick={() => router.push(`/purchase-orders/${po.id}`)}
          disabled={pending}
          className="rounded-md border border-line-strong bg-bg px-4 py-2 text-sm text-ink hover:bg-surface-2 transition disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
