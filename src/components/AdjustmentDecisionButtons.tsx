"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveStockAdjustmentAction, rejectStockAdjustmentAction } from "@/app/actions/inventory";

export function AdjustmentDecisionButtons({ adjustmentId }: { adjustmentId: string }) {
  const router = useRouter();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function approve() {
    setError(null);
    startTransition(async () => {
      const res = await approveStockAdjustmentAction(adjustmentId);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  function reject() {
    setError(null);
    startTransition(async () => {
      const res = await rejectStockAdjustmentAction(adjustmentId, note);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  if (rejecting) {
    return (
      <div className="space-y-1.5">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for rejection…" className="input !py-1 text-xs" />
        {error && <p className="text-xs text-bad">{error}</p>}
        <div className="flex gap-1.5">
          <button type="button" onClick={() => setRejecting(false)} className="flex-1 rounded-md border border-line-strong bg-bg px-2 py-1 text-xs">
            Back
          </button>
          <button type="button" onClick={reject} disabled={pending} className="flex-1 rounded-md bg-bad px-2 py-1 text-xs text-white disabled:opacity-60">
            Confirm
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {error && <p className="text-xs text-bad">{error}</p>}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => setRejecting(true)}
          disabled={pending}
          className="rounded-md border border-bad text-bad bg-bg px-2.5 py-1 text-xs disabled:opacity-60"
        >
          Reject
        </button>
        <button
          type="button"
          onClick={approve}
          disabled={pending}
          className="rounded-md bg-good px-2.5 py-1 text-xs font-medium text-white disabled:opacity-60"
        >
          {pending ? "…" : "Approve"}
        </button>
      </div>
    </div>
  );
}
