"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addItemAltUnitAction,
  toggleItemAltUnitActiveAction,
  deleteItemAltUnitAction,
} from "@/app/actions/items";
import type { Tables } from "@/lib/supabase/database.types";

/**
 * Manages alternate (non-base) units for one item — used ONLY at Sale/Issue/Delivery
 * entry points (Sales Order, Delivery Challan, Invoice, Job material). Purchase/GRN
 * always stays in the item's base_unit and is unaffected by this list.
 */
export function ItemAltUnitsPanel({
  itemId,
  baseUnit,
  units,
  altUnits,
  canManage,
}: {
  itemId: string;
  baseUnit: string;
  units: Tables<"units">[];
  altUnits: Tables<"item_alt_units">[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [unit, setUnit] = useState("");
  const [factor, setFactor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const availableUnits = units.filter((u) => u.code !== baseUnit && !altUnits.some((a) => a.unit === u.code));

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await addItemAltUnitAction(itemId, unit, Number(factor));
      if (res.error) {
        setError(res.error);
        return;
      }
      setUnit("");
      setFactor("");
      router.refresh();
    });
  }

  function toggleActive(id: string, isActive: boolean) {
    setPendingId(id);
    startTransition(async () => {
      await toggleItemAltUnitActiveAction(id, itemId, isActive);
      router.refresh();
      setPendingId(null);
    });
  }

  function remove(id: string) {
    setPendingId(id);
    startTransition(async () => {
      const res = await deleteItemAltUnitAction(id, itemId);
      if (res.error) setError(res.error);
      router.refresh();
      setPendingId(null);
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      <div className="px-4 py-2.5 border-b border-line">
        <h2 className="text-sm font-semibold text-ink">Alternate Units</h2>
        <p className="text-xs text-ink-faint mt-0.5">
          Besides the base unit <span className="font-mono">{baseUnit}</span>, this item can be Sold/Issued/Delivered in these other units
          — Purchases always stay in the base unit.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
            <tr>
              <th className="text-left px-3 py-2">Alt Unit</th>
              <th className="text-right px-3 py-2">1 Alt Unit =</th>
              <th className="text-left px-3 py-2">Status</th>
              {canManage && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {altUnits.map((a) => (
              <tr key={a.id} className="border-t border-line">
                <td className="px-3 py-2 font-mono text-ink">{a.unit}</td>
                <td className="px-3 py-2 text-right tabular text-ink-soft">
                  {a.factor} {baseUnit}
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${a.is_active ? "bg-good-soft text-good" : "bg-surface-2 text-ink-faint"}`}>
                    {a.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                {canManage && (
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => toggleActive(a.id, !a.is_active)}
                      disabled={pending}
                      className="text-xs text-accent-ink underline underline-offset-2 mr-3 disabled:opacity-60"
                    >
                      {pendingId === a.id ? "…" : a.is_active ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(a.id)}
                      disabled={pending}
                      className="text-xs text-bad underline underline-offset-2 disabled:opacity-60"
                    >
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {!altUnits.length && (
              <tr>
                <td colSpan={canManage ? 4 : 3} className="px-4 py-6 text-center text-ink-faint">
                  No alternate unit has been created yet — Sale/Deliver will only happen in the base unit ({baseUnit}).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canManage && (
        <div className="border-t border-line p-4 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
            <select value={unit} onChange={(e) => setUnit(e.target.value)} className="input !py-1.5 text-sm">
              <option value="">— New Alt Unit —</option>
              {availableUnits.map((u) => (
                <option key={u.code} value={u.code}>
                  {u.code} — {u.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              step="0.000001"
              min="0.000001"
              value={factor}
              onChange={(e) => setFactor(e.target.value)}
              placeholder={`How many ${baseUnit} = 1 ${unit || "unit"}?`}
              className="input !py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={submit}
              disabled={pending || !unit || !factor}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition disabled:opacity-60"
            >
              {pending ? "…" : "Add"}
            </button>
          </div>
          <p className="text-xs text-ink-faint">
            Example: base unit is KG, and the item is also sold in PCS where 1 PCS = 12 KG — enter unit = PCS, factor = 12.
          </p>
          {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
        </div>
      )}
    </div>
  );
}
