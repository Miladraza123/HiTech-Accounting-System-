"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordPodAction, recordDisputeAction } from "@/app/actions/deliveryChallans";

export function PodPanel({ dcId, canDispute }: { dcId: string; canDispute: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"none" | "accept" | "dispute">("none");
  const [acceptedByName, setAcceptedByName] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submitAccept() {
    setError(null);
    if (!acceptedByName.trim()) {
      setError("The accepting person's name is required.");
      return;
    }
    startTransition(async () => {
      const res = await recordPodAction(dcId, acceptedByName, note.trim() || null);
      if (res.error) setError(res.error);
      else {
        setMode("none");
        router.refresh();
      }
    });
  }

  function submitDispute() {
    setError(null);
    if (!note.trim()) {
      setError("A dispute reason is required.");
      return;
    }
    startTransition(async () => {
      const res = await recordDisputeAction(dcId, note);
      if (res.error) setError(res.error);
      else {
        setMode("none");
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
      <h2 className="text-sm font-semibold text-ink">Client Acceptance / POD</h2>

      {mode === "none" && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode("accept")}
            className="flex-1 rounded-md bg-good px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition"
          >
            Mark as Accepted
          </button>
          {canDispute && (
            <button
              type="button"
              onClick={() => setMode("dispute")}
              className="flex-1 rounded-md border border-bad text-bad bg-bg px-3 py-1.5 text-xs hover:bg-surface-2 transition"
            >
              Dispute
            </button>
          )}
        </div>
      )}

      {mode === "accept" && (
        <div className="space-y-2">
          <input
            value={acceptedByName}
            onChange={(e) => setAcceptedByName(e.target.value)}
            placeholder="Name of person accepting"
            className="input text-xs"
          />
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Note (optional)" className="input resize-none text-xs" />
          {error && <p className="text-xs text-bad">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setMode("none")} className="flex-1 rounded-md border border-line-strong bg-bg px-2 py-1 text-xs">
              Back
            </button>
            <button type="button" onClick={submitAccept} disabled={pending} className="flex-1 rounded-md bg-good px-2 py-1 text-xs font-medium text-white disabled:opacity-60">
              {pending ? "…" : "Confirm"}
            </button>
          </div>
        </div>
      )}

      {mode === "dispute" && (
        <div className="space-y-2 rounded-md border border-bad bg-bad-soft p-3">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Reason for dispute…" className="input resize-none text-xs" />
          {error && <p className="text-xs text-bad">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setMode("none")} className="flex-1 rounded-md border border-line-strong bg-bg px-2 py-1 text-xs">
              Back
            </button>
            <button type="button" onClick={submitDispute} disabled={pending} className="flex-1 rounded-md bg-bad px-2 py-1 text-xs font-medium text-white disabled:opacity-60">
              {pending ? "…" : "Confirm Dispute"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
