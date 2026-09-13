"use client";

import { useEffect } from "react";
import type { Tables } from "@/lib/supabase/database.types";

export type EditableJvLine = {
  key: string;
  account_code: string;
  dimension: string; // "" | `party:<id>` | `bank:<id>` | `petty_cash:<id>`
  debit: string;
  credit: string;
  memo: string;
};

let keySeq = 0;
function newKey() {
  keySeq += 1;
  return `jv${keySeq}`;
}

export function blankJvLine(): EditableJvLine {
  return { key: newKey(), account_code: "", dimension: "", debit: "", credit: "", memo: "" };
}

export function decodeDimension(dimension: string): { party_id?: string; bank_account_id?: string; petty_cash_fund_id?: string } {
  if (!dimension) return {};
  const [type, id] = dimension.split(":");
  if (type === "party") return { party_id: id };
  if (type === "bank") return { bank_account_id: id };
  if (type === "petty_cash") return { petty_cash_fund_id: id };
  return {};
}

export function JournalVoucherLineEditor({
  accounts,
  parties,
  bankAccounts,
  pettyCashFunds,
  lines,
  onChange,
}: {
  accounts: Tables<"chart_of_accounts">[];
  parties: Tables<"parties">[];
  bankAccounts: Tables<"bank_accounts">[];
  pettyCashFunds: Tables<"petty_cash_funds">[];
  lines: EditableJvLine[];
  onChange: (lines: EditableJvLine[]) => void;
}) {
  useEffect(() => {
    if (lines.length === 0) onChange([blankJvLine(), blankJvLine()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update(key: string, patch: Partial<EditableJvLine>) {
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function remove(key: string) {
    const next = lines.filter((l) => l.key !== key);
    onChange(next.length ? next : [blankJvLine(), blankJvLine()]);
  }

  function addRow() {
    onChange([...lines, blankJvLine()]);
  }

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = Math.round((totalDebit - totalCredit) * 100) === 0 && totalDebit > 0;

  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
            <tr>
              <th className="text-left px-3 py-2 w-56">Account</th>
              <th className="text-left px-3 py-2 w-56">Party / Bank / Petty Cash</th>
              <th className="text-left px-3 py-2">Memo</th>
              <th className="text-right px-3 py-2 w-28 min-w-[7rem]">Debit</th>
              <th className="text-right px-3 py-2 w-28 min-w-[7rem]">Credit</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key} className="border-t border-line">
                <td className="px-2 py-1.5">
                  <select value={l.account_code} onChange={(e) => update(l.key, { account_code: e.target.value })} className="input !py-1 text-xs">
                    <option value="">— Select account —</option>
                    {accounts.map((a) => (
                      <option key={a.code} value={a.code}>
                        {a.code} — {a.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <select value={l.dimension} onChange={(e) => update(l.key, { dimension: e.target.value })} className="input !py-1 text-xs">
                    <option value="">—</option>
                    <optgroup label="Party (AR/AP)">
                      {parties.map((p) => (
                        <option key={p.id} value={`party:${p.id}`}>
                          {p.legal_name}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Bank Account">
                      {bankAccounts.map((b) => (
                        <option key={b.id} value={`bank:${b.id}`}>
                          {b.account_name}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Petty Cash Fund">
                      {pettyCashFunds.map((f) => (
                        <option key={f.id} value={`petty_cash:${f.id}`}>
                          {f.fund_name}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <input value={l.memo} onChange={(e) => update(l.key, { memo: e.target.value })} className="input !py-1 text-xs" placeholder="Memo" />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={l.debit}
                    onChange={(e) => update(l.key, { debit: e.target.value, credit: e.target.value ? "" : l.credit })}
                    className="input !py-1 text-xs text-right tabular"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={l.credit}
                    onChange={(e) => update(l.key, { credit: e.target.value, debit: e.target.value ? "" : l.debit })}
                    className="input !py-1 text-xs text-right tabular"
                  />
                </td>
                <td className="px-1">
                  <button type="button" onClick={() => remove(l.key)} className="text-ink-faint hover:text-bad" title="Remove line">
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-line px-3 py-2">
        <button type="button" onClick={addRow} className="text-xs text-accent-ink underline underline-offset-2">
          + Add line
        </button>
        <div className="text-xs space-x-4 tabular">
          <span className="text-ink-soft">Debit: {totalDebit.toFixed(2)}</span>
          <span className="text-ink-soft">Credit: {totalCredit.toFixed(2)}</span>
          <span className={`font-semibold ${balanced ? "text-good" : "text-bad"}`}>{balanced ? "Balanced ✓" : "Not balanced"}</span>
        </div>
      </div>
    </div>
  );
}
