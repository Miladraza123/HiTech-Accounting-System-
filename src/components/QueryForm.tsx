"use client";

import { useActionState } from "react";
import { createQueryAction, type ActionResult } from "@/app/actions/queries";
import type { Tables } from "@/lib/supabase/database.types";

const initialState: ActionResult = { error: null };

export function QueryForm({
  parties,
  sources,
}: {
  parties: Tables<"parties">[];
  sources: Tables<"query_sources">[];
}) {
  const [state, formAction, pending] = useActionState(createQueryAction, initialState);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={formAction} className="rounded-xl border border-line bg-surface p-6 space-y-4 max-w-xl">
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
        <textarea name="requirement" required rows={3} className="input resize-none" placeholder="Client ko kya chahiye…" />
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

      {state.error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Save ho raha hai…" : "Query Save Karen"}
      </button>
    </form>
  );
}
