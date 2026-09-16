"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateDraftQuotationAction,
  markQuotationSentAction,
  type QuotationLineInput,
} from "@/app/actions/quotations";
import { QuotationLineEditor, type EditableLine , type LineItem} from "@/components/QuotationLineEditor";
import { useItemCatalog } from "@/lib/useItemCatalog";
import type { Tables } from "@/lib/supabase/database.types";

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

export function DraftQuotationEditor({
  quotationId,
  items: itemsProp,
  units,
  initialLines,
  initialTerms,
  initialValidity,
  initialDeliveryTerms,
  initialPaymentTerms,
}: {
  quotationId: string;
  // A first page of items plus those already referenced here — the rest
  // are found by typing, searched in the database. See SearchablePicker.
  items: LineItem[];
  units: Tables<"units">[];
  initialLines: Tables<"quotation_lines">[];
  initialTerms: string | null;
  initialValidity: string | null;
  initialDeliveryTerms: string | null;
  initialPaymentTerms: string | null;
}) {
  // The form works from this list, not the raw prop: every item picked by
  // searching is merged in, so the lookups below keep resolving. See
  // useItemCatalog.
  const { items, addItem } = useItemCatalog(itemsProp);
  const router = useRouter();
  const [lines, setLines] = useState<EditableLine[]>(toEditable(initialLines));
  const [terms, setTerms] = useState(initialTerms ?? "");
  const [validity, setValidity] = useState(initialValidity ?? "");
  const [deliveryTerms, setDeliveryTerms] = useState(initialDeliveryTerms ?? "");
  const [paymentTerms, setPaymentTerms] = useState(initialPaymentTerms ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function saveDraft() {
    setError(null);
    startTransition(async () => {
      const res = await updateDraftQuotationAction(
        quotationId,
        terms || null,
        validity || null,
        deliveryTerms || null,
        paymentTerms || null,
        serialize(lines)
      );
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  function sendIt() {
    setError(null);
    startTransition(async () => {
      const saveRes = await updateDraftQuotationAction(
        quotationId,
        terms || null,
        validity || null,
        deliveryTerms || null,
        paymentTerms || null,
        serialize(lines)
      );
      if (saveRes.error) {
        setError(saveRes.error);
        return;
      }
      const sendRes = await markQuotationSentAction(quotationId);
      if (sendRes.error) setError(sendRes.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <QuotationLineEditor items={items} onItemPicked={addItem} units={units} lines={lines} onChange={setLines} />

      <div className="rounded-xl border border-line bg-surface p-5 space-y-3">
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
      </div>

      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={saveDraft}
          disabled={pending}
          className="rounded-md border border-line-strong bg-bg px-4 py-2 text-sm text-ink hover:bg-surface-2 transition disabled:opacity-60"
        >
          Draft Save Karen
        </button>
        <button
          type="button"
          onClick={sendIt}
          disabled={pending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
        >
          {pending ? "…" : "Client ko Bhej Den (Mark Sent)"}
        </button>
      </div>
    </div>
  );
}
