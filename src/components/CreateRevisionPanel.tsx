"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createQuotationRevisionAction, type QuotationLineInput } from "@/app/actions/quotations";
import { QuotationLineEditor, type EditableLine , type LineItem} from "@/components/QuotationLineEditor";
import { useItemCatalog } from "@/lib/useItemCatalog";
import type { Tables } from "@/lib/supabase/database.types";
import { buttonClass } from "@/components/ui/Button";

function toEditable(lines: Tables<"quotation_lines">[]): EditableLine[] {
  return lines.map((l, i) => ({
    key: `existing-${i}`,
    item_id: l.item_id ?? "",
    description: l.description,
    qty: String(l.qty),
    unit: l.unit ?? "",
    rate: String(l.rate),
    tax_pct: String(l.tax_pct),
  }));
}

function serialize(lines: EditableLine[]): QuotationLineInput[] {
  return lines
    .filter((l) => l.description.trim())
    .map((l) => ({
      item_id: l.item_id || undefined,
      description: l.description,
      qty: Number(l.qty) || 0,
      unit: l.unit || undefined,
      rate: Number(l.rate) || 0,
      tax_pct: Number(l.tax_pct) || 0,
    }));
}

export function CreateRevisionPanel({
  quotationId,
  items: itemsProp,
  units,
  currentLines,
  currentTerms,
  currentValidity,
  currentDeliveryTerms,
  currentPaymentTerms,
}: {
  quotationId: string;
  // A first page of items plus those already referenced here — the rest
  // are found by typing, searched in the database. See SearchablePicker.
  items: LineItem[];
  units: Tables<"units">[];
  currentLines: Tables<"quotation_lines">[];
  currentTerms: string | null;
  currentValidity: string | null;
  currentDeliveryTerms: string | null;
  currentPaymentTerms: string | null;
}) {
  // The form works from this list, not the raw prop: every item picked by
  // searching is merged in, so the lookups below keep resolving. See
  // useItemCatalog.
  const { items, addItem } = useItemCatalog(itemsProp);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<EditableLine[]>(toEditable(currentLines));
  const [terms, setTerms] = useState(currentTerms ?? "");
  const [validity, setValidity] = useState(currentValidity ?? "");
  const [deliveryTerms, setDeliveryTerms] = useState(currentDeliveryTerms ?? "");
  const [paymentTerms, setPaymentTerms] = useState(currentPaymentTerms ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("secondary")}>
        + New Revision
      </button>
    );
  }

  function submit() {
    setError(null);
    if (!reason.trim()) {
      setError("Enter the reason for the revision (e.g., client requested a rate change).");
      return;
    }
    startTransition(async () => {
      const res = await createQuotationRevisionAction(
        quotationId,
        reason,
        terms || null,
        validity || null,
        deliveryTerms || null,
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
      <p className="text-sm font-medium text-ink">New Revision — the previous revision will always be preserved.</p>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-ink-soft">Reason for revision *</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} className="input" placeholder="e.g. Client increased the quantity" />
      </label>

      <QuotationLineEditor items={items} onItemPicked={addItem} units={units} lines={lines} onChange={setLines} />

      <div className="grid grid-cols-2 gap-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Validity Date</span>
          <input type="date" value={validity} onChange={(e) => setValidity(e.target.value)} className="input" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Delivery Terms</span>
          <input value={deliveryTerms} onChange={(e) => setDeliveryTerms(e.target.value)} className="input" />
        </label>
      </div>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-ink-soft">Payment Terms</span>
        <input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} className="input" />
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-ink-soft">Terms &amp; Conditions</span>
        <textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={3} className="input resize-none" />
      </label>

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
          {pending ? "…" : "Save Revision"}
        </button>
      </div>
    </div>
  );
}
