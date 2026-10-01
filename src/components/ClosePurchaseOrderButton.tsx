"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { closePurchaseOrderAction } from "@/app/actions/purchaseOrders";

// For a Partially Received PO where the remaining qty will never actually
// arrive (e.g. a natural weight-tolerance shortfall, not a real pending
// delivery) — mirrors CancelPurchaseOrderButton.tsx's shape, but styled
// neutral/warn rather than destructive-red: closing short isn't an error,
// it's accepting a real-world outcome.
export function ClosePurchaseOrderButton({ purchaseOrderId }: { purchaseOrderId: string }) {
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
        className="w-full rounded-md border border-line-strong text-ink-soft bg-bg px-3 py-1.5 text-xs hover:bg-surface-2 transition"
      >
        Close PO (Accept Shortfall)
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
      const res = await closePurchaseOrderAction(purchaseOrderId, reason);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-2 rounded-md border border-warn bg-warn-soft p-3">
      <p className="text-xs text-ink-soft">
        Marks this PO done even though the pending qty was never fully received — use this when the shortfall will
        never actually arrive (e.g. weight tolerance), not for a delivery that&apos;s just running late.
      </p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="Reason, e.g. Weight tolerance — remainder will never arrive…"
        className="input resize-none text-xs"
      />
      {error && <p className="text-xs text-bad">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className="flex-1 rounded-md border border-line-strong bg-bg px-2 py-1 text-xs">
          Back
        </button>
        <button type="button" onClick={submit} disabled={pending} className="flex-1 rounded-md bg-accent px-2 py-1 text-xs font-medium text-white disabled:opacity-60">
          {pending ? "…" : "Confirm Close"}
        </button>
      </div>
    </div>
  );
}
