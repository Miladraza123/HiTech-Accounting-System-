"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { amendSalesOrderAction, type SalesOrderLineInput } from "@/app/actions/salesOrders";
import { QuotationLineEditor, type EditableLine } from "@/components/QuotationLineEditor";
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
  items,
  units,
  currentLines,
  currentClientPo,
  currentPoDate,
  currentDeliverySchedule,
  currentPaymentTerms,
}: {
  salesOrderId: string;
  items: Tables<"items">[];
  units: Tables<"units">[];
  currentLines: Tables<"sales_order_lines">[];
  currentClientPo: string;
  currentPoDate: string;
  currentDeliverySchedule: string | null;
  currentPaymentTerms: string | null;
}) {
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
        + Amendment Karen
      </button>
    );
  }

  function submit() {
    setError(null);
    if (!reason.trim()) {
      setError("Amendment ki wajah likhen (jaise: client ne quantity badha di).");
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
      <p className="text-sm font-medium text-ink">Amendment — purani state hamesha ke liye history mein mehfooz rahegi.</p>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-ink-soft">Amendment ki wajah *</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} className="input" placeholder="e.g. Client ne quantity 100 se 150 kar di" />
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

      <QuotationLineEditor items={items} units={units} lines={lines} onChange={setLines} />
      <p className="text-xs text-ink-faint">
        Jis line par delivery ho chuki hai usay hataya nahi ja sakta — sirf uski qty/rate badal sakte hain.
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
          {pending ? "…" : "Amendment Save Karen"}
        </button>
      </div>
    </div>
  );
}
