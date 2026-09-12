"use client";

import { useEffect } from "react";
import type { Tables } from "@/lib/supabase/database.types";

export type EditableLine = {
  key: string;
  item_id: string;
  description: string;
  qty: string;
  unit: string;
  rate: string;
  tax_pct: string;
};

let keySeq = 0;
function newKey() {
  keySeq += 1;
  return `l${keySeq}`;
}

export function blankLine(defaultTaxPct = 18): EditableLine {
  return { key: newKey(), item_id: "", description: "", qty: "1", unit: "", rate: "0", tax_pct: String(defaultTaxPct) };
}

export function QuotationLineEditor({
  items,
  units,
  lines,
  onChange,
  defaultTaxPct = 18,
  altUnitsByItem,
}: {
  items: Tables<"items">[];
  units: Tables<"units">[];
  lines: EditableLine[];
  onChange: (lines: EditableLine[]) => void;
  defaultTaxPct?: number;
  /**
   * When provided (Sales Order usage), the Unit dropdown for a line with an item
   * selected is restricted to that item's base_unit + its active alternate units
   * (Sale/Issue/Delivery side multi-unit conversion) instead of the full unit list.
   * When omitted (Quotation / PO usage), behavior is unchanged — any unit is selectable.
   */
  altUnitsByItem?: Record<string, { unit: string; factor: number }[]>;
}) {
  useEffect(() => {
    if (lines.length === 0) onChange([blankLine(defaultTaxPct)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update(key: string, patch: Partial<EditableLine>) {
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function remove(key: string) {
    const next = lines.filter((l) => l.key !== key);
    onChange(next.length ? next : [blankLine(defaultTaxPct)]);
  }

  function addRow() {
    onChange([...lines, blankLine(defaultTaxPct)]);
  }

  function pickItem(key: string, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    if (!item) {
      update(key, { item_id: "" });
      return;
    }
    update(key, {
      item_id: itemId,
      description: item.description,
      unit: item.base_unit,
      rate: String(item.standard_cost || ""),
    });
  }

  const subtotal = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);
  const taxTotal = lines.reduce(
    (s, l) => s + ((Number(l.qty) || 0) * (Number(l.rate) || 0) * (Number(l.tax_pct) || 0)) / 100,
    0
  );

  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
            <tr>
              <th className="text-left px-3 py-2 w-48">Item (optional)</th>
              <th className="text-left px-3 py-2">Description</th>
              <th className="text-right px-3 py-2 w-20">Qty</th>
              <th className="text-left px-3 py-2 w-24">Unit</th>
              <th className="text-right px-3 py-2 w-28">Rate</th>
              <th className="text-right px-3 py-2 w-20">Tax %</th>
              <th className="text-right px-3 py-2 w-28">Amount</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const amount = (Number(l.qty) || 0) * (Number(l.rate) || 0);
              const item = l.item_id ? items.find((i) => i.id === l.item_id) : undefined;
              const unitOptions =
                altUnitsByItem && item
                  ? [item.base_unit, ...(altUnitsByItem[item.id] ?? []).map((a) => a.unit)]
                  : units.map((u) => u.code);
              return (
                <tr key={l.key} className="border-t border-line">
                  <td className="px-2 py-1.5">
                    <select value={l.item_id} onChange={(e) => pickItem(l.key, e.target.value)} className="input !py-1 text-xs">
                      <option value="">— Custom —</option>
                      {items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.item_code} — {i.description}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      value={l.description}
                      onChange={(e) => update(l.key, { description: e.target.value })}
                      required
                      className="input !py-1 text-xs"
                      placeholder="Item / service"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      step="0.001"
                      min="0.001"
                      value={l.qty}
                      onChange={(e) => update(l.key, { qty: e.target.value })}
                      required
                      className="input !py-1 text-xs text-right tabular"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <select value={l.unit} onChange={(e) => update(l.key, { unit: e.target.value })} className="input !py-1 text-xs">
                      <option value="">—</option>
                      {unitOptions.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={l.rate}
                      onChange={(e) => update(l.key, { rate: e.target.value })}
                      required
                      className="input !py-1 text-xs text-right tabular"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={l.tax_pct}
                      onChange={(e) => update(l.key, { tax_pct: e.target.value })}
                      className="input !py-1 text-xs text-right tabular"
                    />
                  </td>
                  <td className="px-3 py-1.5 text-right text-ink tabular whitespace-nowrap">{amount.toFixed(2)}</td>
                  <td className="px-1">
                    <button type="button" onClick={() => remove(l.key)} className="text-ink-faint hover:text-bad" title="Remove line">
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-line px-3 py-2">
        <button type="button" onClick={addRow} className="text-xs text-accent-ink underline underline-offset-2">
          + Add Line
        </button>
        <div className="text-xs text-ink-soft space-x-4 tabular">
          <span>Subtotal: {subtotal.toFixed(2)}</span>
          <span>Tax: {taxTotal.toFixed(2)}</span>
          <span className="font-semibold text-ink">Total: {(subtotal + taxTotal).toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
