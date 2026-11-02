"use client";

import { useState, useTransition } from "react";
import { updateInvoiceDetailsAction, type InvoiceDetailsInput } from "@/app/actions/invoices";
import { InvoiceDetailsFields } from "@/components/InvoiceDetailsFields";

/** Print details of a posted invoice (D.C #, terms, due date, contact, weight, note), editable by Owner/Accounts. */
export function InvoiceDetailsEditor({ invoiceId, initial, canEdit }: { invoiceId: string; initial: InvoiceDetailsInput; canEdit: boolean }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await updateInvoiceDetailsAction(invoiceId, value);
      if (res.error) setError(res.error);
      else setSaved(true);
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-ink">Print details</h2>
        <p className="text-[11px] text-ink-faint">Shown on the printed invoice. They don&apos;t affect amounts or the ledger.</p>
      </div>
      <InvoiceDetailsFields
        value={value}
        onChange={(v) => {
          setValue(v);
          setSaved(false);
        }}
        disabled={!canEdit}
      />
      {canEdit && (
        <div className="space-y-1.5">
          {error && <p className="text-xs text-bad">{error}</p>}
          {saved && <p className="text-xs text-good">Saved.</p>}
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save details"}
          </button>
        </div>
      )}
    </div>
  );
}
