"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPeriodLockAction } from "@/app/actions/setup";

export function PeriodLockForm({ currentLockDate }: { currentLockDate: string | null }) {
  const router = useRouter();
  const [date, setDate] = useState(currentLockDate ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await setPeriodLockAction(date || null);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  function clearLock() {
    setDate("");
    setError(null);
    startTransition(async () => {
      const res = await setPeriodLockAction(null);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-5 space-y-3 max-w-md">
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-ink-soft">Lock Date</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
      </label>
      <p className="text-xs text-ink-faint">
        No new financial entry (Invoice, Payment, Expense, GRN, Return, Journal Voucher, etc.) can be posted on or before this date — not even for the Owner. Leave it blank and click Clear to remove the lock.
      </p>
      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
        >
          {pending ? "…" : "Save Lock"}
        </button>
        {currentLockDate && (
          <button
            type="button"
            onClick={clearLock}
            disabled={pending}
            className="rounded-md border border-line-strong bg-bg px-4 py-2 text-sm text-ink hover:bg-surface-2 transition disabled:opacity-60"
          >
            Remove Lock
          </button>
        )}
      </div>
    </div>
  );
}
