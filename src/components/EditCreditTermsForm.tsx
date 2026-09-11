"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCreditTermsAction } from "@/app/actions/parties";

export function EditCreditTermsForm({ partyId, creditLimit, creditDays }: { partyId: string; creditLimit: number; creditDays: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(String(creditLimit));
  const [days, setDays] = useState(String(creditDays));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-accent-ink underline underline-offset-2">
        Credit terms edit karen
      </button>
    );
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await updateCreditTermsAction(partyId, Number(limit) || 0, Number(days) || 0);
      if (res.error) setError(res.error);
      else {
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-2 rounded-md border border-line bg-bg p-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1">
          <span className="text-[11px] text-ink-faint">Credit Limit</span>
          <input type="number" step="0.01" min="0" value={limit} onChange={(e) => setLimit(e.target.value)} className="input !py-1 text-xs" />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] text-ink-faint">Credit Days</span>
          <input type="number" step="1" min="0" value={days} onChange={(e) => setDays(e.target.value)} className="input !py-1 text-xs" />
        </label>
      </div>
      {error && <p className="text-xs text-bad">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className="flex-1 rounded-md border border-line-strong bg-bg px-2 py-1 text-xs">
          Wapis
        </button>
        <button type="button" onClick={submit} disabled={pending} className="flex-1 rounded-md bg-accent px-2 py-1 text-xs font-medium text-white disabled:opacity-60">
          {pending ? "…" : "Save"}
        </button>
      </div>
    </div>
  );
}
