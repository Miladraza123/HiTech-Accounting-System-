"use client";

import { useState, useTransition } from "react";
import { toggleBankAccountActiveAction } from "@/app/actions/cashBank";

export function ToggleBankAccountButton({ id, isActive }: { id: string; isActive: boolean }) {
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
            // A dropped connection makes the server action throw — show a
            // message instead of letting it crash the page.
            try {
              const res = await toggleBankAccountActiveAction(id, !isActive);
              if (res.error) setError(res.error);
            } catch {
              setError("Could not reach the server. Check your connection and try again.");
            }
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
