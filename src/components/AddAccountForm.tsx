"use client";

import { useActionState, useRef, useEffect } from "react";
import { addAccountAction, type ActionResult } from "@/app/actions/setup";
import type { Tables } from "@/lib/supabase/database.types";

const initialState: ActionResult = { error: null };

const TYPES = [
  { value: "asset", label: "Asset" },
  { value: "liability", label: "Liability" },
  { value: "equity", label: "Equity" },
  { value: "income", label: "Income" },
  { value: "expense", label: "Expense" },
];

export function AddAccountForm({ accounts }: { accounts: Tables<"chart_of_accounts">[] }) {
  const [state, formAction, pending] = useActionState(addAccountAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="rounded-xl border border-line bg-surface p-5 space-y-3">
      <div className="grid grid-cols-[100px_1fr] gap-3">
        <input name="code" placeholder="Code" required className="input font-mono" />
        <input name="name" placeholder="Account name" required className="input" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <select name="account_type" required defaultValue="" className="input">
          <option value="" disabled>
            Type
          </option>
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select name="parent_id" defaultValue="" className="input">
          <option value="">Parent account (optional)</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} — {a.name}
            </option>
          ))}
        </select>
      </div>
      {state.error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Adding…" : "Add Account"}
      </button>
    </form>
  );
}
