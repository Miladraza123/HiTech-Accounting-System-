"use client";

import { useEffect } from "react";
import type { Tables } from "@/lib/supabase/database.types";

export type EditableMaterialLine = {
  key: string;
  item_id: string;
  qty: string;
  unit: string;
};

let keySeq = 0;
function newKey() {
  keySeq += 1;
  return `m${keySeq}`;
}

export function blankMaterialLine(): EditableMaterialLine {
  return { key: newKey(), item_id: "", qty: "1", unit: "" };
}

/**
 * A lighter-weight line editor than QuotationLineEditor — just item + qty +
 * unit, no rate/tax. Reused for both BOM template lines (qty = per output
 * unit) and manual per-Job material requirement lines (qty = required qty).
 */
export function MaterialLineEditor({
  items,
  units,
  lines,
  onChange,
  qtyLabel = "Qty",
  altUnitsByItem,
}: {
  items: Tables<"items">[];
  units: Tables<"units">[];
  lines: EditableMaterialLine[];
  onChange: (lines: EditableMaterialLine[]) => void;
  qtyLabel?: string;
  /**
   * When provided, the Unit dropdown for a line with an item selected is restricted
   * to that item's base_unit + its active alternate units (multi-unit conversion —
   * qty entered here gets converted to base_unit before being sent to the server,
   * since stock/reservation tracking is always base_unit-denominated).
   */
  altUnitsByItem?: Record<string, { unit: string; factor: number }[]>;
}) {
  useEffect(() => {
    if (lines.length === 0) onChange([blankMaterialLine()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update(key: string, patch: Partial<EditableMaterialLine>) {
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function remove(key: string) {
    const next = lines.filter((l) => l.key !== key);
    onChange(next.length ? next : [blankMaterialLine()]);
  }

  function addRow() {
    onChange([...lines, blankMaterialLine()]);
  }

  function pickItem(key: string, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    if (!item) {
      update(key, { item_id: "" });
      return;
    }
    update(key, { item_id: itemId, unit: item.base_unit });
  }

  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
            <tr>
              <th className="text-left px-3 py-2">Raw Material / Item</th>
              <th className="text-right px-3 py-2 w-28">{qtyLabel}</th>
              <th className="text-left px-3 py-2 w-24">Unit</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const item = l.item_id ? items.find((i) => i.id === l.item_id) : undefined;
              const unitOptions =
                altUnitsByItem && item
                  ? [item.base_unit, ...(altUnitsByItem[item.id] ?? []).map((a) => a.unit)]
                  : units.map((u) => u.code);
              const nonBaseUnit = !!item && !!l.unit && l.unit !== item.base_unit;
              return (
                <tr key={l.key} className="border-t border-line">
                  <td className="px-2 py-1.5">
                    <select value={l.item_id} onChange={(e) => pickItem(l.key, e.target.value)} required className="input !py-1 text-xs">
                      <option value="">— Select item —</option>
                      {items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.item_code} — {i.description}
                        </option>
                      ))}
                    </select>
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
                    {altUnitsByItem && nonBaseUnit && (
                      <p className="text-[10px] text-ink-faint text-right mt-0.5">base unit mein convert hoga</p>
                    )}
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
                  <td className="px-1">
                    <button type="button" onClick={() => remove(l.key)} className="text-ink-faint hover:text-bad" title="Line hatayen">
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t border-line px-3 py-2">
        <button type="button" onClick={addRow} className="text-xs text-accent-ink underline underline-offset-2">
          + Line add karen
        </button>
      </div>
    </div>
  );
}
