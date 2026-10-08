"use client";

import { useState, useTransition } from "react";
import { toggleWarehouseAction } from "@/app/actions/setup";

export function ToggleWarehouseButton({ id, isActive }: { id: string; isActive: boolean }) {
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
            const res = await toggleWarehouseAction(id, !isActive);
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
