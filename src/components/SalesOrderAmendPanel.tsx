"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { amendSalesOrderAction, type SalesOrderLineInput } from "@/app/actions/salesOrders";
import { QuotationLineEditor, type EditableLine , type LineItem} from "@/components/QuotationLineEditor";
import { useItemCatalog } from "@/lib/useItemCatalog";
import type { Tables } from "@/lib/supabase/database.types";

function toEditable(lines: Tables<"sales_order_lines">[]): EditableLine[] {
  return lines.map((l) => ({
    key: l.id,
    item_id: l.item_id ?? "",
    description: l.description,
    qty: String(l.ordered_qty),
    unit: l.unit ?? "",
    rate: String(l.rate),
    tax_pct: String(l.tax_pct),
  }));
}

function serialize(lines: EditableLine[]): SalesOrderLineInput[] {
  return lines
    .filter((l) => l.description.trim())
    .map((l) => ({
      id: l.key.startsWith("l") ? undefined : l.key, // "lN" keys are new rows added client-side
      item_id: l.item_id || undefined,
      description: l.description,
      ordered_qty: Number(l.qty) || 0,
      unit: l.unit || undefined,
      rate: Number(l.rate) || 0,
      tax_pct: Number(l.tax_pct) || 0,
    }));
}

export function SalesOrderAmendPanel({
  salesOrderId,
  items: itemsProp,
  units,
  currentLines,
  currentClientPo,
  currentPoDate,
  currentDeliverySchedule,
  currentPaymentTerms,
}: {
  salesOrderId: string;
  // A first page of items plus those already referenced here — the rest
  // are found by typing, searched in the database. See SearchablePicker.
  items: LineItem[];
  units: Tables<"units">[];
  currentLines: Tables<"sales_order_lines">[];
  currentClientPo: string;
  currentPoDate: string;
  currentDeliverySchedule: string | null;
  currentPaymentTerms: string | null;
}) {
  // The form works from this list, not the raw prop: every item picked by
  // searching is merged in, so the lookups below keep resolving. See
  // useItemCatalog.
  const { items, addItem, altUnitsByItem } = useItemCatalog(itemsProp);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<EditableLine[]>(toEditable(currentLines));
  const [clientPo, setClientPo] = useState(currentClientPo);
  const [poDate, setPoDate] = useState(currentPoDate);
  const [deliverySchedule, setDeliverySchedule] = useState(currentDeliverySchedule ?? "");
  const [paymentTerms, setPaymentTerms] = useState(currentPaymentTerms ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-line-strong bg-bg px-4 py-2 text-sm text-ink hover:bg-surface-2 transition"
      >
        + Amend
      </button>
    );
  }

  function submit() {
    setError(null);
    if (!reason.trim()) {
      setError("Enter the reason for the amendment (e.g. client increased the quantity).");
      return;
    }
    startTransition(async () => {
      const res = await amendSalesOrderAction(
        salesOrderId,
        reason,
        clientPo,
        poDate,
        deliverySchedule || null,
        paymentTerms || null,
        serialize(lines)
      );
      if (res.error) setError(res.error);
      else {
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4 rounded-xl border border-accent bg-accent-soft/30 p-5">
      <p className="text-sm font-medium text-ink">Amendment — the previous state is always preserved in history.</p>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-ink-soft">Reason for Amendment *</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} className="input" placeholder="e.g. Client increased quantity from 100 to 150" />
      </label>

      <div className="grid grid-cols-2 gap-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Client PO Number</span>
          <input value={clientPo} onChange={(e) => setClientPo(e.target.value)} className="input" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">PO Date</span>
          <input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} className="input" />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Delivery Schedule</span>
          <input type="date" value={deliverySchedule} onChange={(e) => setDeliverySchedule(e.target.value)} className="input" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Payment Terms</span>
          <input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} className="input" />
        </label>
      </div>

      <QuotationLineEditor items={items} onItemPicked={addItem} units={units} lines={lines} onChange={setLines} altUnitsByItem={altUnitsByItem} />
      <p className="text-xs text-ink-faint">
        A line that has already been delivered cannot be removed — only its qty/rate can be changed.
      </p>

      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-line-strong bg-bg px-4 py-2 text-sm text-ink hover:bg-surface-2 transition"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
        >
          {pending ? "…" : "Save Amendment"}
        </button>
      </div>
    </div>
  );
}
