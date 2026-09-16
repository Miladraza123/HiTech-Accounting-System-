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

  return { items, addItem };
}
