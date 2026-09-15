"use client";

import { useActionState, useState } from "react";
import { createQuotationAction, type ActionResult } from "@/app/actions/quotations";
import { QuotationLineEditor, blankLine, type EditableLine } from "@/components/QuotationLineEditor";
import type { Tables } from "@/lib/supabase/database.types";
import { useOfflineQueue } from "@/components/OfflineQueueProvider";
import { useOfflineSubmitGuard } from "@/lib/useOfflineSubmitGuard";

const initialState: ActionResult = { error: null };

function serializeLines(lines: EditableLine[]) {
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

// Phase 2 (Master Offline-First Roadmap): Quotation (Rev-0) creation is
// pure document creation (no stock posting, no financial commitment), so
// like Query/Task it's genuinely low-risk offline. Same pattern as
// QueryForm.tsx: online, this form behaves exactly as before (native form
// action -> createQuotationAction); offline, submission is intercepted
// before the native action runs and queued in IndexedDB with a
// browser-generated UUID, replayed through `fn_create_quotation_idempotent`
// the moment connectivity returns. NOTE: this is only reachable offline if
// the parent Query already exists server-side — see this form's own RPC
// entry in offlineQueue.ts for why.
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
  const { isOnline, enqueue } = useOfflineQueue();
  const [savedOffline, setSavedOffline] = useState(false);
  // Guards the offline branch below against a rapid double-click — see
  // useOfflineSubmitGuard's own comment for why `pending` above (from
  // useActionState) can't do this on its own for this specific path.
  const { isSubmitting, guard } = useOfflineSubmitGuard();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (isOnline) return; // let the normal <form action> submission run, unchanged
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    await guard(async () => {
      await enqueue({
        kind: "create",
        table: "quotations",
        recordId: crypto.randomUUID(),
        label: "Quotation",
        payload: {
          query_id: queryId,
          terms: String(formData.get("terms") ?? "").trim() || null,
          validity_date: String(formData.get("validity_date") ?? "") || null,
          delivery_terms: String(formData.get("delivery_terms") ?? "").trim() || null,
          payment_terms: String(formData.get("payment_terms") ?? "").trim() || null,
          lines: serializeLines(lines),
        },
      });
      setSavedOffline(true);
    });
  }

  if (savedOffline) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 max-w-xl space-y-3">
        <p className="rounded-md bg-good-soft px-3 py-2 text-sm text-good">
          Quotation saved on this device — it will get its Quotation number and sync automatically once you&apos;re
          back online.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} className="space-y-4">
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

      {!isOnline && (
        <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
          ⏳ You&apos;re offline — this Quotation will be saved on this device and synced automatically once
          you&apos;re back online.
        </p>
      )}

      {state.error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{state.error}</p>}

      <button
        type="submit"
        disabled={pending || isSubmitting}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending || isSubmitting ? "Saving…" : isOnline ? "Save Quotation (Rev-0)" : "Save Offline"}
      </button>
    </form>
  );
}
