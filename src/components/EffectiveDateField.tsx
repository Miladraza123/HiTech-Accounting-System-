"use client";

import { karachiToday } from "@/lib/karachiTime";

function firstOfMonth(iso: string, addMonths: number): string {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + addMonths, 1));
  return d.toISOString().slice(0, 10);
}

/**
 * "Effective from" for any policy or terms change. Deliberately starts
 * empty: the person saving the change has to choose the date, and every
 * day before it keeps the old rules.
 */
export function EffectiveDateField({
  value,
  onChange,
  min,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  min?: string;
  disabled?: boolean;
}) {
  const today = karachiToday();
  const quick: [string, string][] = [
    ["Today", today],
    ["1st of this month", firstOfMonth(today, 0)],
    ["1st of next month", firstOfMonth(today, 1)],
  ];
  return (
    <div className="space-y-1.5">
      <label htmlFor="effective-from" className="text-xs font-medium text-ink-soft">
        Effective from *
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="effective-from"
          type="date"
          value={value}
          min={min}
          required
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="input max-w-[11rem]"
        />
        {quick
          .filter(([, d]) => !min || d >= min)
          .map(([label, d]) => (
            <button
              key={label}
              type="button"
              disabled={disabled}
              onClick={() => onChange(d)}
              className={`rounded-md border px-2 py-1 text-[11px] transition ${
                value === d ? "border-accent text-accent-ink" : "border-line-strong text-ink-soft hover:bg-surface-2"
              }`}
            >
              {label}
            </button>
          ))}
      </div>
      <p className="text-[11px] text-ink-faint">
        The change applies from this date onwards. Days before it keep the rules they had.
      </p>
    </div>
  );
}
