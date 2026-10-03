"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adjustPartyBalanceAction } from "@/app/actions/parties";

/**
 * Owner/Accounts only. There's no "opening balance" field to edit — the
 * balance is purely the sum of journal_lines for this party's receivable/
 * payable account (what Party Ledger already shows). Correcting it posts a
 * new adjusting entry for the difference; fn_adjust_party_balance computes
 * that difference itself from the true current balance, so this panel just
 * asks "what should it actually be?" rather than "how much do you want to
 * change it by?".
 */
export function AdjustPartyBalancePanel({
  partyId,
  direction,
  label,
  currentBalance,
}: {
  partyId: string;
  direction: "receivable" | "payable";
  label: string;
  currentBalance: number;
}) {
  const router = useRouter();
  const [value, setValue] = useState(String(currentBalance));
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    setSuccess(false);
    const newBalance = Number(value);
    if (Number.isNaN(newBalance) || newBalance < 0) {
      setError("Enter a valid, non-negative amount.");
      return;
    }
    if (newBalance === currentBalance) {
      setError("That's already the current balance.");
      return;
    }
    startTransition(async () => {
      const res = await adjustPartyBalanceAction(partyId, direction, newBalance);
      if (res.error) setError(res.error);
      else {
        setSuccess(true);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-1">
      <div className="flex items-end gap-2">
        <label className="block space-y-1 flex-1">
          <span className="text-xs text-ink-faint">
            {label} — current: {currentBalance.toLocaleString()}
          </span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="input !py-1 text-sm tabular"
          />
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-md border border-line bg-bg px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-surface-2 transition disabled:opacity-60"
        >
          {pending ? "…" : "Correct"}
        </button>
      </div>
      {error && <p className="text-xs text-bad">{error}</p>}
      {success && <p className="text-xs text-good">Adjusted.</p>}
    </div>
  );
}
