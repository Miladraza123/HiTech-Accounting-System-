"use client";

import { useCallback, useMemo, useState } from "react";
import type { LineItem } from "@/components/QuotationLineEditor";

/**
 * Keeps track of which items a form actually knows about.
 *
 * Line-editor forms used to be handed every item in the catalogue, so a
 * plain `items.find(...)` always resolved. Now a page sends only a first
 * page and the rest are found by typing (see SearchablePicker) — so an item
 * the user searched for would not be in that list, and any lookup against
 * it would silently miss. That matters: the unit conversion in
 * NewJobForm/NewProductTemplateForm reads the item's `base_unit` to convert
 * an entered qty into base units before it reaches the stock ledger, and a
 * missed lookup there would post the wrong quantity.
 *
 * So every pick is reported back up here and merged into the list the form
 * works from, keeping all existing lookups correct without any of them
 * having to change.
 */
export function useItemCatalog(initial: LineItem[]) {
  const [extra, setExtra] = useState<LineItem[]>([]);

  const items = useMemo(
    () => [...initial, ...extra.filter((e) => !initial.some((i) => i.id === e.id))],
    [initial, extra]
  );

  const addItem = useCallback((item: LineItem) => {
    setExtra((prev) => (prev.some((i) => i.id === item.id) ? prev : [...prev, item]));
  }, []);

  /**
   * The active unit conversions for every item this form knows about,
   * keyed by item id — the shape the line editors' Unit dropdown and the
   * forms' qty-to-base-unit conversion already expect.
   *
   * Derived from `items` rather than from a separate whole-table fetch,
   * because each item carries its own `item_alt_units` (see LineItem). An
   * item found by typing therefore arrives with its factors already
   * attached, which is the whole reason these pages no longer need to load
   * every row of item_alt_units to convert one line.
   */
  const altUnitsByItem = useMemo(() => {
    const map: Record<string, { unit: string; factor: number }[]> = {};
    for (const item of items) {
      for (const a of item.item_alt_units ?? []) {
        if (!a.is_active) continue;
        (map[item.id] ??= []).push({ unit: a.unit, factor: a.factor });
      }
    }
    return map;
  }, [items]);

  return { items, addItem, altUnitsByItem };
}
