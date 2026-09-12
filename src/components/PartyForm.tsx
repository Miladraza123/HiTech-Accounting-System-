"use client";

import { useActionState, useRef, useEffect } from "react";
import { createPartyAction, type ActionResult } from "@/app/actions/parties";
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

export function PartyForm({ provinces, defaultType = "client" }: { provinces: Tables<"provinces">[]; defaultType?: string }) {
  const [state, formAction, pending] = useActionState(createPartyAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="rounded-xl border border-line bg-surface p-5 space-y-5">
      <div className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Basic Info</p>
        <div className="grid grid-cols-[1fr_140px] gap-3">
          <Field label="Client/Supplier ka naam" required>
            <input name="legal_name" required className="input" />
          </Field>
          <Field label="Type">
            <select name="party_type" defaultValue={defaultType} className="input">
              <option value="client">Client</option>
              <option value="supplier">Supplier</option>
              <option value="both">Dono</option>
            </select>
          </Field>
        </div>
      </div>

      <div className="space-y-3 border-t border-line pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Tax &amp; Registration</p>
        <div className="grid grid-cols-3 gap-3">
          <Field label="NTN">
            <input name="ntn" className="input" />
          </Field>
          <Field label="STRN">
            <input name="strn" className="input" />
          </Field>
          <Field label="CNIC (agar individual ho)">
            <input name="cnic" className="input" />
          </Field>
        </div>
        <Field label="Address">
          <input name="billing_address" className="input" />
        </Field>
        <Field label="Province">
          <select name="province" defaultValue="" className="input">
            <option value="">— Select —</option>
            {provinces.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="space-y-3 border-t border-line pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Credit Terms</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Credit Limit">
            <input name="credit_limit" type="number" step="0.01" min="0" className="input" />
          </Field>
          <Field label="Credit Days">
            <input name="credit_days" type="number" min="0" className="input" />
          </Field>
        </div>
      </div>

      {state.error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{state.error}</p>}
      {state.success && <p className="rounded-md bg-good-soft px-3 py-2 text-sm text-good">Add ho gaya.</p>}

      <div className="border-t border-line pt-4">
        <button type="submit" disabled={pending} className={buttonClass("primary", "md", "disabled:opacity-60")}>
          {pending ? "Add ho raha hai…" : "Add Karen"}
        </button>
      </div>
    </form>
  );
}
