"use client";

import { useActionState, useRef, useEffect } from "react";
import { createPartyAction, type ActionResult } from "@/app/actions/parties";
import type { Tables } from "@/lib/supabase/database.types";

const initialState: ActionResult = { error: null };

export function PartyForm({ provinces, defaultType = "client" }: { provinces: Tables<"provinces">[]; defaultType?: string }) {
  const [state, formAction, pending] = useActionState(createPartyAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="rounded-xl border border-line bg-surface p-5 space-y-3">
      <div className="grid grid-cols-[1fr_140px] gap-3">
        <input name="legal_name" placeholder="Client/Supplier ka naam *" required className="input" />
        <select name="party_type" defaultValue={defaultType} className="input">
          <option value="client">Client</option>
          <option value="supplier">Supplier</option>
          <option value="both">Dono</option>
        </select>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <input name="ntn" placeholder="NTN" className="input" />
        <input name="strn" placeholder="STRN" className="input" />
        <input name="cnic" placeholder="CNIC (agar individual ho)" className="input" />
      </div>
      <input name="billing_address" placeholder="Address" className="input" />
      <div className="grid grid-cols-3 gap-3">
        <select name="province" defaultValue="" className="input">
          <option value="">Province</option>
          {provinces.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </select>
        <input name="credit_limit" type="number" step="0.01" placeholder="Credit Limit" className="input" />
        <input name="credit_days" type="number" placeholder="Credit Days" className="input" />
      </div>
      {state.error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Add ho raha hai…" : "Add Karen"}
      </button>
    </form>
  );
}
