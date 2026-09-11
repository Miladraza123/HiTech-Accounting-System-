"use client";

import { useTransition } from "react";
import { togglePartyActiveAction } from "@/app/actions/parties";

export function PartyToggle({ id, isActive }: { id: string; isActive: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => togglePartyActiveAction(id, !isActive))}
      className="text-xs text-accent-ink underline underline-offset-2 disabled:opacity-50"
    >
      {isActive ? "Deactivate" : "Activate"}
    </button>
  );
}
