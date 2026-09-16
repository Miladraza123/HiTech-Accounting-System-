"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useOfflineQueue } from "@/components/OfflineQueueProvider";
import { getCachedMasterData } from "@/lib/offlineQueue";

export type PickerOption = { id: string; label: string; hint?: string; pendingQueuedId?: string };

/** Which master-data table this picker searches, and how a row becomes an option. */
export type PickerSource = {
  table: "parties" | "items";
  /**
   * Exactly the columns the option list renders — nothing more. A master
   * table carries fields this dropdown has no business shipping to the
   * browser (a party's credit limit and NTN, an item's costing), and
   * `select("*")` would send all of them on every keystroke.
   */
  columns: string;
  /** Columns the server-side ILIKE search runs across. Filtering on a
   *  column does not require selecting it. */
  searchColumns: string[];
  toOption: (row: Record<string, unknown>) => PickerOption;
  /** Extra equality filters, e.g. only active rows. */
  match?: Record<string, string | boolean>;
};

export const PARTY_SOURCE: PickerSource = {
  table: "parties",
  columns: "id, legal_name",
  searchColumns: ["legal_name", "ntn"],
  match: { is_active: true },
  toOption: (r) => ({ id: String(r.id), label: String(r.legal_name ?? "") }),
};

export const ITEM_SOURCE: PickerSource = {
  table: "items",
  columns: "id, item_code, description",
  searchColumns: ["item_code", "description"],
  match: { is_active: true },
  toOption: (r) => ({ id: String(r.id), label: String(r.item_code ?? ""), hint: String(r.description ?? "") }),
};

const RESULT_LIMIT = 20;
const DEBOUNCE_MS = 250;

/**
 * A type-to-search replacement for a master-data <select> that used to be
 * handed every row in the table.
 *
 * The page now sends only a first page of options; anything beyond that is
 * found by typing, and the search runs in the database (ILIKE, capped at
 * RESULT_LIMIT) instead of in the browser over a list that grows with the
 * catalogue.
 *
 * Offline it falls back to exactly what the app already caches for this
 * purpose — `masterDataCache`, filled on every reconnect since Phase 9 —
 * and filters that locally, so an offline user keeps the same full list
 * they had before. Still-queued offline creates are merged in on top, the
 * same way the plain <select> did it, so a Party created offline stays
 * pickable straight away.
 *
 * Submits through a hidden input under `name`, so the surrounding
 * <form action> keeps working unchanged. Required-ness is enforced where it
 * already was — in the server action and in the offline enqueue path —
 * because a hidden input is not covered by native form validation.
 */
export function SearchablePicker({
  name,
  source,
  initialOptions,
  pendingOptions = [],
  placeholder = "Type to search…",
  onChange,
}: {
  name: string;
  source: PickerSource;
  initialOptions: PickerOption[];
  pendingOptions?: PickerOption[];
  placeholder?: string;
  onChange?: (option: PickerOption | null) => void;
}) {
  const { isOnline } = useOfflineQueue();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<PickerOption | null>(null);
  // Holds SEARCH results together with the term they were fetched for.
  // Keeping the term here means "am I still searching?" is derived
  // (`results.term !== term`) rather than a second state flag that an
  // effect has to keep in sync. With an empty box the list shown is
  // `initialOptions`, derived below rather than copied into state.
  const [results, setResults] = useState<{ term: string; options: PickerOption[] }>({
    term: "",
    options: [],
  });
  const boxRef = useRef<HTMLDivElement>(null);

  const allPending = useMemo(
    () => pendingOptions.map((p) => ({ ...p, hint: "offline — pending sync" })),
    [pendingOptions]
  );

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const term = query.trim();

  useEffect(() => {
    if (!term) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      let found: PickerOption[] = [];

      if (isOnline) {
        const supabase = createClient();
        let q = supabase.from(source.table).select(source.columns);
        for (const [col, val] of Object.entries(source.match ?? {})) q = q.eq(col, val);
        // `or` with ilike gives one round trip across every searchable column.
        const escaped = term.replace(/[%,()]/g, " ");
        q = q.or(source.searchColumns.map((c) => `${c}.ilike.%${escaped}%`).join(","));
        const { data } = await q.limit(RESULT_LIMIT);
        // `columns` is a runtime string, so supabase-js cannot infer the row
        // shape here; `toOption` is what actually knows it, per source.
        const rows = (data ?? []) as unknown as Record<string, unknown>[];
        found = rows.map((row) => source.toOption(row));
      } else {
        // Offline: the same rows the app already caches for this purpose.
        const rows = await getCachedMasterData<Record<string, unknown>>(source.table);
        const lower = term.toLowerCase();
        found = rows
          .filter((r) => (source.match ? Object.entries(source.match).every(([c, v]) => r[c] === v) : true))
          .filter((r) => source.searchColumns.some((c) => String(r[c] ?? "").toLowerCase().includes(lower)))
          .slice(0, RESULT_LIMIT)
          .map((r) => source.toOption(r));
      }

      if (!cancelled) setResults({ term, options: found });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term, isOnline, source]);

  function pick(option: PickerOption) {
    setSelected(option);
    setQuery("");
    setOpen(false);
    onChange?.(option);
  }

  function clear() {
    setSelected(null);
    setQuery("");
    onChange?.(null);
  }

  // True from the keystroke until this exact term's results land — which
  // covers the debounce window too, so the list never shows the previous
  // term's matches as if they were final.
  const searching = !!term && results.term !== term;
  const lowered = term.toLowerCase();
  // Still-queued offline creates are matched locally and instantly, so they
  // stay listed while a server search is in flight — a Party you created
  // offline a moment ago must not vanish behind "Searching…".
  const pendingShown = allPending.filter((p) => !lowered || p.label.toLowerCase().includes(lowered));
  const base = term ? results.options : initialOptions;
  const baseShown = searching ? [] : base.filter((r) => !allPending.some((p) => p.id === r.id));
  const shown = [...pendingShown, ...baseShown];

  return (
    <div ref={boxRef} className="relative">
      <input type="hidden" name={name} value={selected?.id ?? ""} />

      {selected ? (
        <div className="input flex items-center justify-between gap-2">
          <span className="truncate text-ink">{selected.label}</span>
          <button
            type="button"
            onClick={clear}
            className="shrink-0 rounded px-1.5 text-xs text-ink-faint hover:text-ink"
            aria-label="Change selection"
          >
            Change
          </button>
        </div>
      ) : (
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="input"
          autoComplete="off"
        />
      )}

      {open && !selected && (
        <div className="absolute z-40 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-line bg-surface shadow-lg">
          {shown.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => pick(o)}
              className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-surface-2"
            >
              {o.label}
              {o.hint && <span className="block text-[11px] text-ink-faint">{o.hint}</span>}
            </button>
          ))}
          {searching && <p className="px-3 py-2 text-xs text-ink-faint">Searching…</p>}
          {!searching && !shown.length && (
            <p className="px-3 py-2 text-xs text-ink-faint">
              {term ? "No match found." : "Start typing to search…"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
