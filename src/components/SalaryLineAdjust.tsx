"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setSalaryAdjustmentAction } from "@/app/actions/hr";

/** Bonus / other deduction / advance recovery for one draft line. */
export function SalaryLineAdjust({
  sheetId,
  lineId,
  bonus,
  otherDeduction,
  advanceRecovery,
  note,
  advanceOwed,
}: {
  sheetId: string;
  lineId: string;
  bonus: number;
  otherDeduction: number;
  advanceRecovery: number;
  note: string | null;
  advanceOwed: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [b, setB] = useState(String(bonus));
  const [d, setD] = useState(String(otherDeduction));
  const [a, setA] = useState(String(advanceRecovery));
  const [n, setN] = useState(note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-accent-ink underline underline-offset-2">
        Adjust
      </button>
    );
  }

  function save() {
    setError(null);
    const nums = [Number(b || 0), Number(d || 0), Number(a || 0)];
    if (nums.some((x) => !Number.isFinite(x) || x < 0)) return setError("Amounts must be 0 or more.");
    startTransition(async () => {
      const res = await setSalaryAdjustmentAction(sheetId, lineId, { bonus: nums[0], other_deduction: nums[1], advance_recovery: nums[2], note: n });
      if (res.error) return setError(res.error);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-1.5 min-w-[12rem] text-left">
      <label className="flex items-center justify-between gap-2 text-[11px]">
        Bonus
        <input type="number" min="0" step="0.01" value={b} onChange={(e) => setB(e.target.value)} className="input text-xs w-24" />
      </label>
      <label className="flex items-center justify-between gap-2 text-[11px]">
        Other cut
        <input type="number" min="0" step="0.01" value={d} onChange={(e) => setD(e.target.value)} className="input text-xs w-24" />
      </label>
      <label className="flex items-center justify-between gap-2 text-[11px]">
        Advance back
        <input type="number" min="0" step="0.01" max={advanceOwed} value={a} onChange={(e) => setA(e.target.value)} className="input text-xs w-24" />
      </label>
      <p className="text-[10px] text-ink-faint">Advance owed: Rs {advanceOwed.toLocaleString()}</p>
      <input value={n} onChange={(e) => setN(e.target.value)} placeholder="Note (needed for bonus / cut)" className="input text-xs" />
      {error && <p className="text-[11px] text-bad">{error}</p>}
      <div className="flex gap-1">
        <button type="button" onClick={() => setOpen(false)} className="flex-1 rounded border border-line-strong px-2 py-0.5 text-xs">
          Back
        </button>
        <button type="button" disabled={pending} onClick={save} className="flex-1 rounded bg-accent px-2 py-0.5 text-xs text-white disabled:opacity-60">
          {pending ? "…" : "Save"}
        </button>
      </div>
    </div>
  );
}
