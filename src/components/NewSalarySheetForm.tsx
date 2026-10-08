"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateSalarySheetAction } from "@/app/actions/hr";
import { monthRange, shiftMonth } from "@/lib/hrMonth";
import { karachiToday } from "@/lib/karachiTime";

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Last fully finished week starting on `weekStart` (0 = Sunday). */
function lastWeek(today: string, weekStart: number, days: number): { from: string; to: string } {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const back = (dow - weekStart + 7) % 7;
  const thisStart = addDays(today, -back);
  const from = addDays(thisStart, -days);
  return { from, to: addDays(from, days - 1) };
}

export function NewSalarySheetForm({ weekStart }: { weekStart: number }) {
  const router = useRouter();
  const today = karachiToday();
  const [kind, setKind] = useState<"monthly" | "wager">("monthly");
  const [month, setMonth] = useState(shiftMonth(today.slice(0, 7), -1));
  const [cycle, setCycle] = useState<"weekly" | "fortnightly">("weekly");
  const initialWeek = lastWeek(today, weekStart, 7);
  const [from, setFrom] = useState(initialWeek.from);
  const [to, setTo] = useState(initialWeek.to);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function pickCycle(c: typeof cycle) {
    setCycle(c);
    const r = lastWeek(today, weekStart, c === "weekly" ? 7 : 14);
    setFrom(r.from);
    setTo(r.to);
  }

  function submit() {
    setError(null);
    const range = kind === "monthly" ? monthRange(month) : { from, to };
    if (!range.from || !range.to) return setError("Choose the period.");
    startTransition(async () => {
      const res = await generateSalarySheetAction({ kind, wager_cycle: kind === "wager" ? cycle : null, ...range, note });
      if (res.error) return setError(res.error);
      router.push(`/hr/salary/${res.id}`);
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4 sm:p-5 space-y-4">
      <h2 className="text-sm font-semibold text-ink">New Salary Sheet</h2>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="inline-flex items-center gap-2">
          <input type="radio" checked={kind === "monthly"} onChange={() => setKind("monthly")} />
          Monthly (permanent staff, and wagers paid monthly)
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="radio" checked={kind === "wager"} onChange={() => setKind("wager")} />
          Daily wagers (weekly / fortnightly)
        </label>
      </div>
      {kind === "monthly" ? (
        <label className="block space-y-1.5 max-w-xs">
          <span className="text-xs font-medium text-ink-soft">Month</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="input" />
        </label>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Pay cycle</span>
            <select value={cycle} onChange={(e) => pickCycle(e.target.value as typeof cycle)} className="input">
              <option value="weekly">Weekly</option>
              <option value="fortnightly">Every 2 weeks</option>
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">From</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">To</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input" />
          </label>
        </div>
      )}
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-ink-soft">Note</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} className="input" />
      </label>
      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Calculating…" : "Create Draft Sheet"}
      </button>
    </div>
  );
}
