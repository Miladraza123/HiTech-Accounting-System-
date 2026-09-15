"use client";

import { useActionState, useRef, useEffect, useState } from "react";
import { createPartyAction, type ActionResult } from "@/app/actions/parties";
import type { Tables } from "@/lib/supabase/database.types";
import { buttonClass } from "@/components/ui/Button";
import { useOfflineQueue } from "@/components/OfflineQueueProvider";
import { useOfflineSubmitGuard } from "@/lib/useOfflineSubmitGuard";

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

// Phase 1 (Master Offline-First Roadmap): Client/Supplier is master data
// every later document (Query, Quotation, Sales Order, Purchase Order,
// ...) references, so it has to be creatable offline first. Same pattern
// as QueryForm.tsx (Phase 22 pilot): online, this form behaves exactly as
// before (native form action -> createPartyAction); offline, submission is
// intercepted before the native action runs and queued in IndexedDB with a
// browser-generated UUID, replayed through `fn_create_party_idempotent`
// (safe to retry) the moment connectivity returns.
export function PartyForm({ provinces, defaultType = "client" }: { provinces: Tables<"provinces">[]; defaultType?: string }) {
  const [state, formAction, pending] = useActionState(createPartyAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const { isOnline, enqueue } = useOfflineQueue();
  const [savedOffline, setSavedOffline] = useState(false);
  // Guards the offline branch below against a rapid double-click — see
  // useOfflineSubmitGuard's own comment for why `pending` above (from
  // useActionState) can't do this on its own for this specific path.
  const { isSubmitting, guard } = useOfflineSubmitGuard();

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (isOnline) return; // let the normal <form action> submission run, unchanged
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    await guard(async () => {
      await enqueue({
        kind: "create",
        table: "parties",
        recordId: crypto.randomUUID(),
        label: "Client/Supplier",
        payload: {
          legal_name: String(formData.get("legal_name") ?? "").trim(),
          party_type: String(formData.get("party_type") ?? "client"),
          ntn: String(formData.get("ntn") ?? "").trim() || null,
          strn: String(formData.get("strn") ?? "").trim() || null,
          cnic: String(formData.get("cnic") ?? "").trim() || null,
          billing_address: String(formData.get("billing_address") ?? "").trim() || null,
          province: String(formData.get("province") ?? "").trim() || null,
          credit_limit: Number(formData.get("credit_limit") ?? 0),
          credit_days: Number(formData.get("credit_days") ?? 0),
        },
      });
      form.reset();
      setSavedOffline(true);
    });
  }

  if (savedOffline) {
    return (
      <div className="rounded-xl border border-line bg-surface p-5 space-y-3">
        <p className="rounded-md bg-good-soft px-3 py-2 text-sm text-good">
          Saved on this device — it will sync automatically once you&apos;re back online.
        </p>
        <button type="button" onClick={() => setSavedOffline(false)} className={buttonClass("secondary", "sm")}>
          + Add another
        </button>
      </div>
    );
  }

  return (
    <form ref={formRef} action={formAction} onSubmit={handleSubmit} className="rounded-xl border border-line bg-surface p-5 space-y-5">
      <div className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Basic Info</p>
        <div className="grid grid-cols-[1fr_140px] gap-3">
          <Field label="Client/Supplier Name" required>
            <input name="legal_name" required className="input" />
          </Field>
          <Field label="Type">
            <select name="party_type" defaultValue={defaultType} className="input">
              <option value="client">Client</option>
              <option value="supplier">Supplier</option>
              <option value="both">Both</option>
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
          <Field label="CNIC (if individual)">
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

      {!isOnline && (
        <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
          ⏳ You&apos;re offline — this will be saved on this device and synced automatically once you&apos;re back
          online.
        </p>
      )}

      {state.error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{state.error}</p>}
      {state.success && <p className="rounded-md bg-good-soft px-3 py-2 text-sm text-good">Added.</p>}

      <div className="border-t border-line pt-4">
        <button type="submit" disabled={pending || isSubmitting} className={buttonClass("primary", "md", "disabled:opacity-60")}>
          {pending || isSubmitting ? "Adding…" : isOnline ? "Add" : "Save Offline"}
        </button>
      </div>
    </form>
  );
}
