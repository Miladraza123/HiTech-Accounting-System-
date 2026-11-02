"use client";

import { useState, useTransition } from "react";
import { updateInvoiceLineDescriptionAction } from "@/app/actions/invoices";

/**
 * Shows an invoice line's description; with `canEdit` a small Edit link opens a
 * box to reword it. Only the wording changes — quantity, rate, tax and amounts
 * stay locked (the ledger is built from them), and each change is recorded.
 */
export function EditInvoiceLineDescription({
  lineId,
  invoiceId,
  description,
  canEdit,
}: {
  lineId: string;
  invoiceId: string;
  description: string;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(description);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <div className="flex items-start gap-2">
        <span className="whitespace-pre-line">{description}</span>
        {canEdit && (
          <button
            type="button"
            onClick={() => {
              setText(description);
              setError(null);
              setEditing(true);
            }}
            className="shrink-0 text-xs text-accent-ink underline underline-offset-2"
          >
            Edit
          </button>
        )}
      </div>
    );
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateInvoiceLineDescriptionAction(lineId, invoiceId, text);
      if (res.error) setError(res.error);
      else setEditing(false);
    });
  }

  return (
    <div className="space-y-1.5">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={2000}
        aria-label="Line description"
        className="input text-xs resize-y"
      />
      {error && <p className="text-xs text-bad">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white hover:opacity-90 transition disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={pending}
          className="rounded-md border border-line-strong bg-bg px-3 py-1 text-xs text-ink hover:bg-surface-2 transition disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
