"use client";

import { useTransition } from "react";
import { togglePettyCashFundActiveAction } from "@/app/actions/cashBank";

export function TogglePettyCashFundButton({ id, isActive }: { id: string; isActive: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => togglePettyCashFundActiveAction(id, !isActive))}
      className="text-xs text-accent-ink underline underline-offset-2 disabled:opacity-50"
    >
      {isActive ? "Deactivate" : "Activate"}
    </button>
  );
}
