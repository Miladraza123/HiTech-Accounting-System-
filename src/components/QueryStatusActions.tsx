"use client";

import { useState, useTransition } from "react";
import { setQueryStatusAction } from "@/app/actions/queries";

export function QueryStatusActions({ queryId, currentStatus }: { queryId: string; currentStatus: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go(status: string) {
    setError(null);
    startTransition(async () => {
      const res = await setQueryStatusAction(queryId, status, null);
      if (res.error) setError(res.error);
    });
  }

  const options: { status: string; label: string; tone: string }[] =
    currentStatus === "OnHold" || currentStatus === "Lost"
      ? [{ status: "Open", label: "Dobara Open Karen", tone: "border-line-strong" }]
      : currentStatus === "Won"
        ? []
        : [
            { status: "OnHold", label: "On Hold Karen", tone: "border-warn text-warn" },
            { status: "Lost", label: "Lost Mark Karen", tone: "border-bad text-bad" },
          ];

  if (!options.length) return null;

  return (
    <div className="space-y-1.5 pt-1 border-t border-line">
      {options.map((o) => (
        <button
          key={o.status}
          type="button"
          disabled={pending}
          onClick={() => go(o.status)}
          className={`w-full rounded-md border ${o.tone} bg-bg px-3 py-1.5 text-xs hover:bg-surface-2 transition disabled:opacity-50`}
        >
          {o.label}
        </button>
      ))}
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}
