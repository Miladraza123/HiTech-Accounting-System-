"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLineChargesAction, reloadLineChargesAction } from "@/app/actions/hr";

export type LineCharge = { id: string; name: string; amount: number; source_amount: number | null; note: string | null };

type Row = { key: string; id?: string; name: string; amount: string; note: string; source: number | null };
let counter = 0;

/** Fixed charges of one draft salary line: change the amount for this month only, add one, or reload the set ones. */
export function SalaryLineCharges({ sheetId, lineId, charges }: { sheetId: string; lineId: string; charges: LineCharge[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function begin() {
    setRows(charges.map((c) => ({ key: c.id, id: c.id, name: c.name, amount: String(c.amount), note: c.note ?? "", source: c.source_amount })));
    setError(null);
    setOpen(true);
  }

  if (!open) {
    return (
      <button type="button" onClick={begin} className="text-xs text-accent-ink underline underline-offset-2">
        Fixed charges
      </button>
    );
  }

  const patch = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  function save() {
    setError(null);
    const out = rows.map((r) => ({ id: r.id, name: r.name.trim(), amount: Number(r.amount === "" ? 0 : r.amount), note: r.note }));
    startTransition(async () => {
      const res = await setLineChargesAction(sheetId, lineId, out);
      if (res.error) return setError(res.error);
      setOpen(false);
      router.refresh();
    });
  }

  function reload() {
    setError(null);
    startTransition(async () => {
      const res = await reloadLineChargesAction(sheetId, lineId);
      if (res.error) return setError(res.error);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-1.5 min-w-[14rem] text-left">
      {rows.length === 0 && <p className="text-[11px] text-ink-faint">No fixed charges on this line.</p>}
      {rows.map((r) => {
        const changed = r.source !== null && Number(r.amount || 0) !== r.source;
        return (
          <div key={r.key} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              {r.id ? (
                <span title={r.source !== null ? `Set amount ${r.source}` : "Added on this sheet"}>{r.name}</span>
              ) : (
                <input value={r.name} onChange={(e) => patch(r.key, { name: e.target.value })} placeholder="Name" maxLength={60} className="input text-xs w-24" aria-label="Charge name" />
              )}
              <span className="flex items-center gap-1">
                <input type="number" min="0" step="0.01" value={r.amount} onChange={(e) => patch(r.key, { amount: e.target.value })} className="input text-xs w-20" aria-label={`${r.name} amount`} />
                <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="text-bad" title="Remove from this month" aria-label="Remove">
                  ×
                </button>
              </span>
            </div>
            {(changed || r.note) && (
              <input value={r.note} onChange={(e) => patch(r.key, { note: e.target.value })} placeholder={changed ? "Note (needed for the change)" : "Note"} className="input text-xs" aria-label="Note" />
            )}
          </div>
        );
      })}
      <button type="button" onClick={() => setRows((rs) => [...rs, { key: `n${++counter}`, name: "", amount: "", note: "", source: null }])} className="text-[11px] text-accent-ink underline underline-offset-2">
        + Add a charge for this month
      </button>
      <p className="text-[10px] text-ink-faint">Changes here apply to this sheet only; the set amount does not change.</p>
      {error && <p className="text-[11px] text-bad">{error}</p>}
      <div className="flex gap-1">
        <button type="button" onClick={() => setOpen(false)} className="flex-1 rounded border border-line-strong px-2 py-0.5 text-xs">
          Back
        </button>
        <button type="button" disabled={pending} onClick={save} className="flex-1 rounded bg-accent px-2 py-0.5 text-xs text-white disabled:opacity-60">
          {pending ? "…" : "Save"}
        </button>
      </div>
      <button type="button" disabled={pending} onClick={reload} className="text-[11px] text-ink-soft underline underline-offset-2" title="Replaces this line's charges with the set ones">
        Load set charges again
      </button>
    </div>
  );
}
