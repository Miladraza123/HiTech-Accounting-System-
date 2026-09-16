"use client";

import { useEffect } from "react";
import { SearchablePicker, ITEM_SOURCE, ACTIVE_ONLY, type PickerOption } from "@/components/SearchablePicker";
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

/** One alternate-unit conversion for an item: 1 <unit> = <factor> base units. */
export type LineItemAltUnit = { item_id: string; unit: string; factor: number; is_active: boolean };

/**
 * Exactly the item fields this editor reads — including the item's own
 * alternate units.
 *
 * Carrying the conversions on the item itself is what lets a page stop
 * loading the whole `item_alt_units` table. An item found by typing brings
 * its own factors with it, so a qty entered in a non-base unit still
 * converts correctly for an item that was never in the page's first page.
 */
export type LineItem = Pick<Tables<"items">, "id" | "item_code" | "description" | "base_unit" | "standard_cost"> & {
  item_alt_units?: LineItemAltUnit[];
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
  onItemPicked,
  defaultTaxPct = 18,
  altUnitsByItem,
}: {
  /**
   * A first page of items PLUS every item already referenced by `lines`.
   * Anything else is found by typing, which searches in the database — so
   * this list no longer grows with the catalogue, while an existing line
   * still resolves its own item's code and base unit locally.
   */
  items: LineItem[];
  units: Tables<"units">[];
  lines: EditableLine[];
  onChange: (lines: EditableLine[]) => void;
  /** Called with a row picked by searching, so the form can remember it —
   *  see useItemCatalog. */
  onItemPicked: (item: LineItem) => void;
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

  const itemOptions: PickerOption[] = items.map((i) => ({
    id: i.id,
    label: i.item_code,
    hint: i.description,
    row: i as unknown as Record<string, unknown>,
  }));

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

  function pickItem(key: string, option: PickerOption | null) {
    if (!option?.row) {
      update(key, { item_id: "" });
      return;
    }
    const item = option.row as unknown as LineItem;
    // Report the pick upward so the form's own `items` list — which its
    // unit conversion and label lookups read — learns about a row that was
    // never in the page's first page. See useItemCatalog.
    onItemPicked(item);
    update(key, {
      item_id: item.id,
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
              <th className="text-left px-3 py-2 w-64 min-w-[16rem]">Item (optional)</th>
              <th className="text-left px-3 py-2 min-w-[14rem]">Description</th>
              <th className="text-right px-3 py-2 w-24 min-w-[6rem]">Qty</th>
              <th className="text-left px-3 py-2 w-28 min-w-[7rem]">Unit</th>
              <th className="text-right px-3 py-2 w-32 min-w-[8rem]">Rate</th>
              <th className="text-right px-3 py-2 w-24 min-w-[6rem]">Tax %</th>
              <th className="text-right px-3 py-2 w-32 min-w-[8rem]">Amount</th>
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
                    <SearchablePicker
                      name={`line_item_${l.key}`}
                      source={ITEM_SOURCE}
                      filters={ACTIVE_ONLY}
                      initialOptions={itemOptions}
                      initialSelected={
                        item ? { id: item.id, label: item.item_code, hint: item.description } : null
                      }
                      placeholder="— Custom — or type a code…"
                      onChange={(o) => pickItem(l.key, o)}
                    />
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
