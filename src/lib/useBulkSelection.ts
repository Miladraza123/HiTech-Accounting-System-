import { useMemo, useState } from "react";

/** Shared checkbox-selection state for a page of list rows — used by the "select multiple, then bulk export/cancel" pattern on Payments, Queries, and Quotations. */
export function useBulkSelection<T extends { id: string }>(rows: T[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      if (rows.length > 0 && rows.every((r) => prev.has(r.id))) return new Set();
      return new Set(rows.map((r) => r.id));
    });
  }

  function clear() {
    setSelected(new Set());
  }

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);

  return { selected, selectedRows, allSelected, toggle, toggleAll, clear };
}
