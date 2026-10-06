"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDispatchGoAheadAction, acceptDispatchGoAheadAction, completeDispatchGoAheadAction } from "@/app/actions/dispatch";

const STATUS_STYLE: Record<string, string> = {
  Pending: "bg-warn-soft text-warn",
  Accepted: "bg-ledger-soft text-ledger",
  Completed: "bg-good-soft text-good",
};

export type GoAheadRow = { id: string; given_to: string; given_to_name: string; given_by_name: string; status: string; created_at: string };

export function DispatchGoAheadPanel({
  deliveryChallanId,
  goAheads,
  currentUserId,
  canRequest,
  dispatchUsers,
}: {
  deliveryChallanId: string;
  goAheads: GoAheadRow[];
  currentUserId: string;
  canRequest: boolean;
  dispatchUsers: { id: string; full_name: string }[];
}) {
  const router = useRouter();
  const [givenTo, setGivenTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function request() {
    setError(null);
    if (!givenTo) {
      setError("Select who to give the go-ahead to.");
      return;
    }
    startTransition(async () => {
      const res = await createDispatchGoAheadAction(deliveryChallanId, givenTo);
      if (res.error) setError(res.error);
      else {
        setGivenTo("");
        router.refresh();
      }
    });
  }

  function accept(goAheadId: string) {
    startTransition(async () => {
      await acceptDispatchGoAheadAction(goAheadId, deliveryChallanId);
      router.refresh();
    });
  }

  function complete(goAheadId: string) {
    startTransition(async () => {
      await completeDispatchGoAheadAction(goAheadId, deliveryChallanId);
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
      <h2 className="text-sm font-semibold text-ink">Dispatch Go-Ahead</h2>

      {goAheads.map((g) => (
        <div key={g.id} className="rounded-md border border-line p-2.5 space-y-1.5 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-ink-soft text-xs">{g.given_by_name} → {g.given_to_name}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[g.status] ?? ""}`}>{g.status}</span>
          </div>
          {g.given_to === currentUserId && g.status === "Pending" && (
            <button type="button" onClick={() => accept(g.id)} disabled={pending} className="w-full rounded-md bg-accent px-2 py-1.5 text-xs font-medium text-white disabled:opacity-60">
              {pending ? "…" : "Accept"}
            </button>
          )}
          {g.given_to === currentUserId && g.status === "Accepted" && (
            <button type="button" onClick={() => complete(g.id)} disabled={pending} className="w-full rounded-md bg-good px-2 py-1.5 text-xs font-medium text-white disabled:opacity-60">
              {pending ? "…" : "Mark Delivery Complete"}
            </button>
          )}
        </div>
      ))}
      {!goAheads.length && <p className="text-xs text-ink-faint">No Go-Ahead sent yet.</p>}

      {canRequest && !goAheads.some((g) => g.status === "Pending") && (
        <div className="space-y-2 border-t border-line pt-3">
          <select value={givenTo} onChange={(e) => setGivenTo(e.target.value)} className="input !py-1.5 text-xs">
            <option value="">— Select Dispatch person —</option>
            {dispatchUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name}
              </option>
            ))}
          </select>
          {error && <p className="text-xs text-bad">{error}</p>}
          <button type="button" onClick={request} disabled={pending} className="w-full rounded-md border border-line bg-bg px-2 py-1.5 text-xs text-ink-soft hover:bg-surface-2 disabled:opacity-60">
            {pending ? "…" : "Send Go-Ahead"}
          </button>
        </div>
      )}
    </div>
  );
}
