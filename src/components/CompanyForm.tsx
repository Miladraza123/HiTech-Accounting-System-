"use client";

import { useActionState, useRef, useState } from "react";
import { saveCompanyAction, type ActionResult } from "@/app/actions/setup";
import type { Tables } from "@/lib/supabase/database.types";
import { diffFields, type SmartMergeConflict } from "@/lib/smartMerge";
import { useOfflineQueue } from "@/components/OfflineQueueProvider";

const initialState: ActionResult = { error: null };

const FIELD_LABEL: Record<string, string> = {
  legal_name: "Company Name",
  ntn: "NTN",
  strn: "STRN",
  address: "Address",
  province: "Province",
  phone: "Phone",
  email: "Email",
  default_sales_tax_pct: "Default Sales Tax (GST) %",
};

type FormValues = {
  legal_name: string;
  ntn: string;
  strn: string;
  address: string;
  province: string;
  phone: string;
  email: string;
  default_sales_tax_pct: string;
};

export function CompanyForm({
  company,
  provinces,
}: {
  company: Tables<"company"> | null;
  provinces: Tables<"provinces">[];
}) {
  const [state, formAction, pending] = useActionState(saveCompanyAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const { isOnline, enqueue } = useOfflineQueue();
  const [queuedOffline, setQueuedOffline] = useState(false);

  const loaded: FormValues = {
    legal_name: company?.legal_name ?? "",
    ntn: company?.ntn ?? "",
    strn: company?.strn ?? "",
    address: company?.address ?? "",
    province: company?.province ?? "",
    phone: company?.phone ?? "",
    email: company?.email ?? "",
    default_sales_tax_pct: String(company?.default_sales_tax_pct ?? 18),
  };
  // `base` is what this browser tab believes is currently saved — it
  // starts as the values loaded on page render and advances (per field)
  // whenever a Smart Merge conflict is resolved, so the next save is
  // compared against the right starting point.
  const [base, setBase] = useState<FormValues>(loaded);
  const [values, setValues] = useState<FormValues>(loaded);
  const conflicts = state.conflicts ?? [];

  // After a save, any field the user changed that DIDN'T conflict has
  // already been written to the database — advance this tab's own "base"
  // for those fields so the next save is compared against what's actually
  // true now (otherwise a second edit would spuriously see this tab's OWN
  // first save as if "someone else" had changed the field). Adjusting
  // state during render (rather than in an effect) is the recommended way
  // to react to a prop/state change without an extra render pass.
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.success) {
      setBase(values);
      setQueuedOffline(false);
    } else if (state.conflicts && state.conflicts.length > 0) {
      const conflictFields = new Set(state.conflicts.map((c) => c.field));
      setBase((b) => {
        const updated = { ...b };
        (Object.keys(values) as (keyof FormValues)[]).forEach((k) => {
          if (!conflictFields.has(k)) updated[k] = values[k];
        });
        return updated;
      });
    }
  }

  function setField(key: keyof FormValues, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  // Offline: queue the write for later instead of letting the form POST
  // fail outright. Only makes sense once a company row already exists —
  // first-time setup (no row yet) has nothing to 3-way-merge against, so
  // that one still requires connectivity. It will be replayed through the
  // exact same Smart Merge RPC an online save uses the moment
  // connectivity returns — never a blind overwrite.
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (isOnline || !company) return;
    event.preventDefault();
    const baseNormalized = { ...base, default_sales_tax_pct: Number(base.default_sales_tax_pct) };
    const nextNormalized = { ...values, default_sales_tax_pct: Number(values.default_sales_tax_pct) };
    const changes = diffFields(baseNormalized, nextNormalized);
    if (Object.keys(changes).length === 0) return;
    enqueue({ table: "company", rowId: company.id, label: "Company Profile", base: baseNormalized, changes }).then(() => {
      setBase(values);
      setQueuedOffline(true);
    });
  }

  function resolveConflict(conflict: SmartMergeConflict, choice: "mine" | "theirs") {
    const key = conflict.field as keyof FormValues;
    const serverValue = String(conflict.server_value ?? "");
    setBase((b) => ({ ...b, [key]: serverValue }));
    if (choice === "theirs") setValues((v) => ({ ...v, [key]: serverValue }));
    // Auto-resubmit once the user has decided — everything else they
    // changed was already saved, this just retries the resolved field(s).
    requestAnimationFrame(() => formRef.current?.requestSubmit());
  }

  return (
    <form ref={formRef} action={formAction} onSubmit={handleSubmit} className="rounded-xl border border-line bg-surface p-6 space-y-4 max-w-xl">
      {(Object.keys(base) as (keyof FormValues)[]).map((key) => (
        <input key={key} type="hidden" name={`base_${key}`} value={base[key]} />
      ))}

      {conflicts.length > 0 && (
        <div className="space-y-2 rounded-md border border-warn bg-warn-soft p-3 text-xs text-ink">
          <p className="font-medium text-warn">
            Someone else changed this field(s) while you were saving — everything else has already been saved,
            you just need to decide:
          </p>
          {conflicts.map((c) => (
            <div key={c.field} className="space-y-1 rounded border border-line-strong bg-bg p-2">
              <p className="text-ink-soft">
                <span className="font-medium">{FIELD_LABEL[c.field] ?? c.field}</span> — Server:{" "}
                <span className="font-mono">{String(c.server_value ?? "—")}</span>, Your value:{" "}
                <span className="font-mono">{String(c.my_value ?? "—")}</span>
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => resolveConflict(c, "mine")} className="flex-1 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-white">
                  Keep my value
                </button>
                <button type="button" onClick={() => resolveConflict(c, "theirs")} className="flex-1 rounded-md border border-line-strong bg-bg px-2 py-1 text-[11px]">
                  Keep server value
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Field label="Company's legal name *">
        <input name="legal_name" value={values.legal_name} onChange={(e) => setField("legal_name", e.target.value)} required className="input" />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="NTN">
          <input name="ntn" value={values.ntn} onChange={(e) => setField("ntn", e.target.value)} className="input" />
        </Field>
        <Field label="STRN">
          <input name="strn" value={values.strn} onChange={(e) => setField("strn", e.target.value)} className="input" />
        </Field>
      </div>

      <Field label="Address">
        <textarea name="address" value={values.address} onChange={(e) => setField("address", e.target.value)} rows={2} className="input resize-none" />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Province">
          <select name="province" value={values.province} onChange={(e) => setField("province", e.target.value)} className="input">
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
            value={values.default_sales_tax_pct}
            onChange={(e) => setField("default_sales_tax_pct", e.target.value)}
            className="input"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Phone">
          <input name="phone" value={values.phone} onChange={(e) => setField("phone", e.target.value)} className="input" />
        </Field>
        <Field label="Email">
          <input name="email" type="email" value={values.email} onChange={(e) => setField("email", e.target.value)} className="input" />
        </Field>
      </div>

      {state.error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{state.error}</p>}
      {state.success && (
        <p className="rounded-md bg-good-soft px-3 py-2 text-sm text-good">Saved.</p>
      )}
      {!isOnline && (
        <p className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
          ⚠ You are offline — saving will queue this change, and it will sync automatically once your connection returns.
        </p>
      )}
      {queuedOffline && (
        <p className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">⏳ Saved offline — waiting to sync.</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save"}
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
