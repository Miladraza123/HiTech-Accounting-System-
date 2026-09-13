"use client";

import { useActionState, useState } from "react";
import { createQueryAction, type ActionResult } from "@/app/actions/queries";
import { useOfflineQueue } from "@/components/OfflineQueueProvider";
import { buttonClass } from "@/components/ui/Button";
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

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (isOnline) return; // let the normal <form action> submission run, unchanged
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    await enqueue({
      kind: "create",
      table: "queries",
      recordId: crypto.randomUUID(),
      label: "Query",
      payload: {
        party_id: String(formData.get("party_id") ?? ""),
        requirement: String(formData.get("requirement") ?? "").trim(),
        source: String(formData.get("source") ?? "") || null,
        query_date: String(formData.get("query_date") ?? "") || today,
        next_followup_at: String(formData.get("next_followup_at") ?? "") || null,
        notes: String(formData.get("notes") ?? "").trim() || null,
      },
    });
    e.currentTarget.reset();
    setSavedOffline(true);
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
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Saving…" : isOnline ? "Save Query" : "Save Offline"}
      </button>
    </form>
  );
}
