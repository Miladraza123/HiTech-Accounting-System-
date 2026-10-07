"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/** A small destructive button that asks once before running a (bound) server action. */
export function ConfirmActionButton({
  label,
  confirmText,
  action,
}: {
  label: string;
  confirmText: string;
  action: () => Promise<{ error: string | null }>;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className="text-xs text-bad underline underline-offset-2">
        {label}
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs">
      <span className="text-ink-soft">{confirmText}</span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await action();
            if (res.error) setError(res.error);
            else {
              setAsking(false);
              router.refresh();
            }
          })
        }
        className="rounded bg-bad px-2 py-0.5 font-medium text-white disabled:opacity-60"
      >
        {pending ? "…" : "Yes"}
      </button>
      <button type="button" onClick={() => setAsking(false)} className="rounded border border-line-strong px-2 py-0.5">
        No
      </button>
      {error && <span className="text-bad">{error}</span>}
    </span>
  );
}
