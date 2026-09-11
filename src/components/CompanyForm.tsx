"use client";

import { useActionState } from "react";
import { saveCompanyAction, type ActionResult } from "@/app/actions/setup";
import type { Tables } from "@/lib/supabase/database.types";

const initialState: ActionResult = { error: null };

export function CompanyForm({
  company,
  provinces,
}: {
  company: Tables<"company"> | null;
  provinces: Tables<"provinces">[];
}) {
  const [state, formAction, pending] = useActionState(saveCompanyAction, initialState);

  return (
    <form action={formAction} className="rounded-xl border border-line bg-surface p-6 space-y-4 max-w-xl">
      <Field label="Company ka qanooni naam *">
        <input name="legal_name" defaultValue={company?.legal_name ?? ""} required className="input" />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="NTN">
          <input name="ntn" defaultValue={company?.ntn ?? ""} className="input" />
        </Field>
        <Field label="STRN">
          <input name="strn" defaultValue={company?.strn ?? ""} className="input" />
        </Field>
      </div>

      <Field label="Address">
        <textarea name="address" defaultValue={company?.address ?? ""} rows={2} className="input resize-none" />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Province">
          <select name="province" defaultValue={company?.province ?? ""} className="input">
            <option value="">— Select —</option>
            {provinces.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Default Sales Tax (GST) %">
          <input
            name="default_sales_tax_pct"
            type="number"
            step="0.01"
            defaultValue={company?.default_sales_tax_pct ?? 18}
            className="input"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Phone">
          <input name="phone" defaultValue={company?.phone ?? ""} className="input" />
        </Field>
        <Field label="Email">
          <input name="email" type="email" defaultValue={company?.email ?? ""} className="input" />
        </Field>
      </div>

      {state.error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{state.error}</p>}
      {state.success && (
        <p className="rounded-md bg-good-soft px-3 py-2 text-sm text-good">Save ho gaya.</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Save ho raha hai…" : "Save karen"}
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  );
}
