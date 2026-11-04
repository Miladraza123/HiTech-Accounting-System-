"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setFixedChargesAction } from "@/app/actions/hr";

type Row = { key: string; id?: string; name: string; amount: string; is_active: boolean };

let counter = 0;
const nextKey = () => `n${++counter}`;

/** The set fixed charges (lunch, uniform, ...) of one employee: add, change, switch off or remove. */
export function FixedChargesEditor({
  employeeId,
  initial,
  canEdit,
}: {
  employeeId: string;
  initial: { id: string; name: string; amount: number; is_active: boolean }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(initial.map((c) => ({ key: c.id, id: c.id, name: c.name, amount: String(c.amount), is_active: c.is_active })));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const update = (key: string, patch: Partial<Row>) => {
    setSaved(false);
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };
  const total = rows.filter((r) => r.is_active).reduce((t, r) => t + (Number(r.amount) || 0), 0);

  function save() {
    setError(null);
    setSaved(false);
    const charges = rows.map((r) => ({ id: r.id, name: r.name.trim(), amount: Number(r.amount), is_active: r.is_active }));
    startTransition(async () => {
      const res = await setFixedChargesAction(employeeId, charges);
      if (res.error) return setError(res.error);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {rows.length === 0 && <p className="text-sm text-ink-faint">No fixed charges set.</p>}
      {rows.map((r) => (
        <div key={r.key} className="flex flex-wrap items-center gap-2">
          <input
            value={r.name}
            onChange={(e) => update(r.key, { name: e.target.value })}
            placeholder="Charge name (e.g. Lunch)"
            disabled={!canEdit}
            maxLength={60}
            className="input text-sm w-44 flex-1 min-w-[9rem]"
            aria-label="Charge name"
          />
          <input
            type="number"
            min="0"
            step="0.01"
            value={r.amount}
            onChange={(e) => update(r.key, { amount: e.target.value })}
            placeholder="Amount"
            disabled={!canEdit}
            className="input text-sm w-28"
            aria-label="Amount"
          />
          <label className="flex items-center gap-1 text-xs text-ink-soft">
            <input type="checkbox" checked={r.is_active} disabled={!canEdit} onChange={(e) => update(r.key, { is_active: e.target.checked })} />
            Active
          </label>
          {canEdit && (
            <button type="button" onClick={() => (setSaved(false), setRows((rs) => rs.filter((x) => x.key !== r.key)))} className="text-xs text-bad underline underline-offset-2">
              Remove
            </button>
          )}
        </div>
      ))}
      <p className="text-xs text-ink-faint">Cut on each salary sheet: Rs {total.toLocaleString()}</p>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => (setSaved(false), setRows((rs) => [...rs, { key: nextKey(), name: "", amount: "", is_active: true }]))}
            className="rounded border border-line-strong px-2.5 py-1 text-xs"
          >
            + Add charge
          </button>
          <button type="button" disabled={pending} onClick={save} className="rounded bg-accent px-3 py-1 text-xs text-white disabled:opacity-60">
            {pending ? "Saving…" : "Save charges"}
          </button>
          {saved && <span className="text-xs text-good">Saved. New salary sheets will use these.</span>}
          {error && <span className="text-xs text-bad">{error}</span>}
        </div>
      )}
    </div>
  );
}
