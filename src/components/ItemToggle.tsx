"use client";

import { useTransition } from "react";
import { toggleItemActiveAction } from "@/app/actions/items";

export function ItemToggle({ id, isActive }: { id: string; isActive: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => toggleItemActiveAction(id, !isActive))}
      className="text-xs text-accent-ink underline underline-offset-2 disabled:opacity-50"
    >
      {isActive ? "Deactivate" : "Activate"}
    </button>
  );
}
