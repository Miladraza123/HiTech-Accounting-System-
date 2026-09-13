"use client";

import { useActionState, useRef, useEffect } from "react";
import { createItemAction, type ActionResult } from "@/app/actions/items";
import type { Tables } from "@/lib/supabase/database.types";
import { buttonClass } from "@/components/ui/Button";

const initialState: ActionResult = { error: null };

function Field({ label, required = false, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-ink-soft">
        {label} {required && <span className="text-bad">*</span>}
      </span>
      {children}
    </label>
  );
}

export function ItemForm({ units }: { units: Tables<"units">[] }) {
  const [state, formAction, pending] = useActionState(createItemAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="rounded-xl border border-line bg-surface p-5 space-y-5">
      <div className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Basic Info</p>
        <div className="grid grid-cols-[140px_1fr] gap-3">
          <Field label="Item Code" required>
            <input name="item_code" required className="input font-mono" />
          </Field>
          <Field label="Description" required>
            <input name="description" required className="input" />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Category">
            <input name="category" placeholder="e.g. Steel" className="input" />
          </Field>
          <Field label="Spec">
            <input name="spec" placeholder="e.g. 6mm MS Sheet" className="input" />
          </Field>
          <Field label="HS Code">
            <input name="hs_code" className="input" />
          </Field>
        </div>
      </div>

      <div className="space-y-3 border-t border-line pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Unit &amp; Tax</p>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Unit" required>
            <select name="base_unit" required defaultValue="" className="input">
              <option value="" disabled>
                — Select —
              </option>
              {units.map((u) => (
                <option key={u.code} value={u.code}>
                  {u.code} — {u.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tax Category">
            <select name="tax_category" defaultValue="standard" className="input">
              <option value="standard">Standard Tax</option>
              <option value="reduced">Reduced Rate</option>
              <option value="zero_rated">Zero-rated</option>
              <option value="exempt">Exempt</option>
            </select>
          </Field>
          <Field label="Standard Cost">
            <input name="standard_cost" type="number" step="0.0001" min="0" className="input" />
          </Field>
        </div>
      </div>

      <div className="space-y-3 border-t border-line pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Stock Tracking</p>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" name="is_stocked" defaultChecked className="h-3.5 w-3.5 accent-[var(--accent)]" />
          This item will be kept in warehouse stock (raw material / stocked goods)
        </label>
        <p className="text-xs text-ink-faint">
          Quantities aren&apos;t set here — they move on their own as GRNs, deliveries, and other stock documents are
          posted. If this item already has stock on hand from before HiTech (e.g. migrating from another system), add
          that as an <span className="font-medium text-ink-soft">Opening Stock</span> from Setup → Import once it&apos;s
          created here.
        </p>
      </div>

      {state.error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{state.error}</p>}
      {state.success && <p className="rounded-md bg-good-soft px-3 py-2 text-sm text-good">Added.</p>}

      <div className="border-t border-line pt-4">
        <button type="submit" disabled={pending} className={buttonClass("primary", "md", "disabled:opacity-60")}>
          {pending ? "Adding…" : "Add Item"}
        </button>
      </div>
    </form>
  );
}
