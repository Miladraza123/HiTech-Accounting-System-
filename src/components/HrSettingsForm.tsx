"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateHrSettingsAction } from "@/app/actions/hr";

export function HrSettingsForm({ salaryJournalEnabled }: { salaryJournalEnabled: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(salaryJournalEnabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(next: boolean) {
    setError(null);
    setOn(next);
    startTransition(async () => {
      const res = await updateHrSettingsAction(next);
      if (res.error) {
        setOn(!next);
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4 sm:p-5 space-y-3">
      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-1" checked={on} disabled={pending} onChange={(e) => toggle(e.target.checked)} />
        <span>
          <span className="block text-sm font-medium text-ink">Post salary to accounts (journal entry)</span>
          <span className="block text-xs text-ink-soft">
            On: when a salary sheet is finalised (salary sheets come in a later update), it posts Salary Expense against Salaries Payable, and paying it clears the payable.
            Off: salary sheets are kept for attendance and payslips only, and nothing is posted to the ledger.
          </span>
        </span>
      </label>
      {pending && <p className="text-xs text-ink-faint">Saving…</p>}
      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
    </div>
  );
}
