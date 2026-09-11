"use client";

import { useTransition } from "react";
import { toggleBankAccountActiveAction } from "@/app/actions/cashBank";

export function ToggleBankAccountButton({ id, isActive }: { id: string; isActive: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => toggleBankAccountActiveAction(id, !isActive))}
      className="text-xs text-accent-ink underline underline-offset-2 disabled:opacity-50"
    >
      {isActive ? "Deactivate" : "Activate"}
    </button>
  );
}
