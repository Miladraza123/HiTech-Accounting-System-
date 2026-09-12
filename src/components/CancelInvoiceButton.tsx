"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelInvoiceAction } from "@/app/actions/invoices";

export function CancelInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-md border border-bad text-bad bg-bg px-3 py-1.5 text-xs hover:bg-surface-2 transition"
      >
        Cancel Invoice
      </button>
    );
  }

  function submit() {
    setError(null);
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    startTransition(async () => {
      const res = await cancelInvoiceAction(invoiceId, reason);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-2 rounded-md border border-bad bg-bad-soft p-3">
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason for cancelling…" className="input resize-none text-xs" />
      {error && <p className="text-xs text-bad">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className="flex-1 rounded-md border border-line-strong bg-bg px-2 py-1 text-xs">
          Back
        </button>
        <button type="button" onClick={submit} disabled={pending} className="flex-1 rounded-md bg-bad px-2 py-1 text-xs font-medium text-white disabled:opacity-60">
          {pending ? "…" : "Confirm Cancel"}
        </button>
      </div>
    </div>
  );
}
