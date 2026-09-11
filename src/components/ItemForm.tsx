"use client";

import { useActionState, useRef, useEffect } from "react";
import { createItemAction, type ActionResult } from "@/app/actions/items";
import type { Tables } from "@/lib/supabase/database.types";

const initialState: ActionResult = { error: null };

export function ItemForm({ units }: { units: Tables<"units">[] }) {
  const [state, formAction, pending] = useActionState(createItemAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="rounded-xl border border-line bg-surface p-5 space-y-3">
      <div className="grid grid-cols-[140px_1fr] gap-3">
        <input name="item_code" placeholder="Item Code *" required className="input font-mono" />
        <input name="description" placeholder="Description *" required className="input" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <input name="category" placeholder="Category (e.g. Steel)" className="input" />
        <input name="spec" placeholder="Spec (e.g. 6mm MS Sheet)" className="input" />
        <input name="hs_code" placeholder="HS Code" className="input" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <select name="base_unit" required defaultValue="" className="input">
          <option value="" disabled>
            Unit *
          </option>
          {units.map((u) => (
            <option key={u.code} value={u.code}>
              {u.code} — {u.name}
            </option>
          ))}
        </select>
        <select name="tax_category" defaultValue="standard" className="input">
          <option value="standard">Standard Tax</option>
          <option value="reduced">Reduced Rate</option>
          <option value="zero_rated">Zero-rated</option>
          <option value="exempt">Exempt</option>
        </select>
        <input name="standard_cost" type="number" step="0.0001" placeholder="Standard Cost" className="input" />
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-soft">
        <input type="checkbox" name="is_stocked" defaultChecked />
        Yeh item warehouse stock mein rakha jayega (raw material / stocked goods)
      </label>

      {state.error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Add ho raha hai…" : "Item Add Karen"}
      </button>
    </form>
  );
}
