"use client";

import { useActionState, useState } from "react";
import { createQuotationAction, type ActionResult } from "@/app/actions/quotations";
import { QuotationLineEditor, blankLine, type EditableLine } from "@/components/QuotationLineEditor";
import type { Tables } from "@/lib/supabase/database.types";

const initialState: ActionResult = { error: null };

export function NewQuotationForm({
  queryId,
  items,
  units,
  defaultTaxPct,
}: {
  queryId: string;
  items: Tables<"items">[];
  units: Tables<"units">[];
  defaultTaxPct: number;
}) {
  const [state, formAction, pending] = useActionState(createQuotationAction, initialState);
  const [lines, setLines] = useState<EditableLine[]>([blankLine(defaultTaxPct)]);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="query_id" value={queryId} />
      <input
        type="hidden"
        name="lines_json"
        value={JSON.stringify(
          lines
            .filter((l) => l.description.trim())
            .map((l) => ({
              item_id: l.item_id || undefined,
              description: l.description,
              qty: Number(l.qty) || 0,
              unit: l.unit || undefined,
              rate: Number(l.rate) || 0,
              tax_pct: Number(l.tax_pct) || 0,
            }))
        )}
        readOnly
      />

      <QuotationLineEditor items={items} units={units} lines={lines} onChange={setLines} defaultTaxPct={defaultTaxPct} />

      <div className="rounded-xl border border-line bg-surface p-5 space-y-3">
        <div className="grid grid-cols-2 gap-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Validity Date</span>
            <input name="validity_date" type="date" className="input" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Delivery Terms</span>
            <input name="delivery_terms" className="input" placeholder="e.g. 15 days from PO" />
          </label>
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Payment Terms</span>
          <input name="payment_terms" className="input" placeholder="e.g. 50% advance, balance on delivery" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Terms &amp; Conditions</span>
          <textarea name="terms" rows={3} className="input resize-none" />
        </label>
      </div>

      {state.error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save Quotation (Rev-0)"}
      </button>
    </form>
  );
}
