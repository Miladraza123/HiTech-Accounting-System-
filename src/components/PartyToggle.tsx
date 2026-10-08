"use client";

import { useState, useTransition } from "react";
import { togglePartyActiveAction } from "@/app/actions/parties";

export function PartyToggle({ id, isActive }: { id: string; isActive: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await togglePartyActiveAction(id, !isActive);
            if (res.error) setError(res.error);
          })
        }
        className="text-xs text-accent-ink underline underline-offset-2 disabled:opacity-50"
      >
        {isActive ? "Deactivate" : "Activate"}
      </button>
      {error && <span className="ml-2 text-xs text-bad">{error}</span>}
    </>
  );
}
