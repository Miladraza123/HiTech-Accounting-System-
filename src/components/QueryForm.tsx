"use client";

import { useActionState, useEffect, useState } from "react";
import { createQueryAction, type ActionResult } from "@/app/actions/queries";
import { useOfflineQueue } from "@/components/OfflineQueueProvider";
import { buttonClass } from "@/components/ui/Button";
import { getPendingCreateOptions, type PendingCreateOption } from "@/lib/offlineQueue";
import { useOfflineSubmitGuard } from "@/lib/useOfflineSubmitGuard";
import type { Tables } from "@/lib/supabase/database.types";

const initialState: ActionResult = { error: null };

/**
 * Offline-first pilot (Phase 22): Query is the safest document type to
 * create while offline — a single-row insert, no line items, no
 * stock/credit checks. When online, this form behaves exactly as
 * before (native form action -> createQueryAction -> redirect to the
 * new Query). When offline, submission is intercepted before the
 * native action runs: the entry is queued in IndexedDB with a
 * browser-generated UUID, and OfflineQueueProvider replays it through
 * `fn_create_query_idempotent` the moment connectivity returns — safe
 * to retry, and two offline users can never collide on the same id.
 */
export function QueryForm({
  parties,
  sources,
}: {
  parties: Tables<"parties">[];
  sources: Tables<"query_sources">[];
}) {
  const [state, formAction, pending] = useActionState(createQueryAction, initialState);
  const { isOnline, enqueue } = useOfflineQueue();
  const [savedOffline, setSavedOffline] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  // Guards the offline branch below against a rapid double-click — see
  // useOfflineSubmitGuard's own comment for why `pending` above (from
  // useActionState) can't do this on its own for this specific path.
  const { isSubmitting, guard } = useOfflineSubmitGuard();

  // Phase 9 (Master Offline-First Roadmap): a Party created offline (on
  // /clients, also warmed) is otherwise invisible in this dropdown until
  // it syncs — the exact reachability gap this whole roadmap's Phase 0
  // comment named as "a later phase" to solve. Merged in here as extra
  // options; picking one threads a `dependsOn` entry so this Query only
  // ever syncs after that Party has (see offlineQueue.ts).
  const [pendingParties, setPendingParties] = useState<PendingCreateOption[]>([]);
  useEffect(() => {
    getPendingCreateOptions("parties").then(setPendingParties);
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (isOnline) return; // let the normal <form action> submission run, unchanged
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    const partyId = String(formData.get("party_id") ?? "");
    const pendingParty = pendingParties.find((p) => p.id === partyId);
    await guard(async () => {
      await enqueue({
        kind: "create",
        table: "queries",
        recordId: crypto.randomUUID(),
        label: "Query",
        payload: {
          party_id: partyId,
          requirement: String(formData.get("requirement") ?? "").trim(),
          source: String(formData.get("source") ?? "") || null,
          query_date: String(formData.get("query_date") ?? "") || today,
          next_followup_at: String(formData.get("next_followup_at") ?? "") || null,
          notes: String(formData.get("notes") ?? "").trim() || null,
        },
        ...(pendingParty ? { dependsOn: [{ queuedId: pendingParty.queuedId, field: "party_id" }] } : {}),
      });
      form.reset();
      setSavedOffline(true);
    });
  }

  if (savedOffline) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 max-w-xl space-y-3">
        <p className="rounded-md bg-good-soft px-3 py-2 text-sm text-good">
          Query saved on this device — it will get its Query number and sync automatically once you&apos;re back
          online.
        </p>
        <button type="button" onClick={() => setSavedOffline(false)} className={buttonClass("secondary", "sm")}>
          + Add another Query
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} className="rounded-xl border border-line bg-surface p-6 space-y-4 max-w-xl">
      <div className="grid grid-cols-2 gap-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Client *</span>
          <select name="party_id" required defaultValue="" className="input">
            <option value="" disabled>
              — Select —
            </option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.legal_name}
              </option>
            ))}
            {pendingParties.map((p) => (
              <option key={p.id} value={p.id}>
                {String(p.payload.legal_name ?? p.label)} (offline — pending sync)
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Query Date</span>
          <input name="query_date" type="date" defaultValue={today} className="input" />
        </label>
      </div>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-ink-soft">Requirement *</span>
        <textarea name="requirement" required rows={3} className="input resize-none" placeholder="What does the client need…" />
      </label>

      <div className="grid grid-cols-2 gap-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Source</span>
          <select name="source" defaultValue="" className="input">
            <option value="">— Select —</option>
            {sources.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Follow-up Date</span>
          <input name="next_followup_at" type="date" className="input" />
        </label>
      </div>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-ink-soft">Notes</span>
        <textarea name="notes" rows={2} className="input resize-none" />
      </label>

      {!isOnline && (
        <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
          ⏳ You&apos;re offline — this Query will be saved on this device and synced automatically once you&apos;re
          back online.
        </p>
      )}

      {state.error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{state.error}</p>}

      <button
        type="submit"
        disabled={pending || isSubmitting}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending || isSubmitting ? "Saving…" : isOnline ? "Save Query" : "Save Offline"}
      </button>
    </form>
  );
}
