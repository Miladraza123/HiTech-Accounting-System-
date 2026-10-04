"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Candidate = {
  id: string;
  quotation_no: string;
  query_no: string;
  party_name: string;
  status: string;
};

const RESULT_LIMIT = 20;
const DEBOUNCE_MS = 250;

/**
 * Inline search box for the Incoming Documents "PO Received" action — picks
 * the Quotation a client's PO confirms (Query No • Quotation No • Party
 * Name, searches all three) and sends the user straight to New Sales Order
 * pre-linked to it. Deliberately online-only: linking carries the Incoming
 * Document's id through to the Sales Order creation so its attachment gets
 * copied over and it gets marked Converted — a side effect that needs a
 * live round trip, so unlike most forms in this app there is no offline
 * fallback here (see NewSalesOrderForm's handling of fromIncomingDocumentId).
 */
export function PoQuotationPicker({ incomingDocumentId, onClose }: { incomingDocumentId: string; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  // Holds results together with the term they were fetched for, so
  // "still searching?" is derived (term !== results.term) instead of a
  // second flag an effect would have to set synchronously on every
  // keystroke, including the empty-query case.
  const [results, setResults] = useState<{ term: string; options: Candidate[] }>({ term: "", options: [] });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [onClose]);

  const term = query.trim();

  useEffect(() => {
    if (!term) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const supabase = createClient();
      const escaped = term.replace(/[%,()]/g, " ");
      const { data } = await supabase
        .from("po_linkable_quotations")
        .select("*")
        .or(`quotation_no.ilike.%${escaped}%,query_no.ilike.%${escaped}%,party_name.ilike.%${escaped}%`)
        .limit(RESULT_LIMIT);
      if (!cancelled) setResults({ term, options: (data ?? []) as Candidate[] });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term]);

  const searching = !!term && results.term !== term;
  const shown = term ? results.options : [];

  function pick(c: Candidate) {
    router.push(`/sales-orders/new?quotation_id=${c.id}&from_incoming_document_id=${incomingDocumentId}`);
  }

  return (
    <div ref={ref} className="rounded-md border border-line bg-bg p-3 space-y-2">
      <p className="text-xs font-medium text-ink-soft">Which Quotation is this PO against?</p>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by Query No, Quotation No or Party Name…"
        autoFocus
        className="input"
      />
      <div className="max-h-56 overflow-y-auto divide-y divide-line rounded-md border border-line bg-surface">
        {searching && <p className="px-3 py-2 text-xs text-ink-faint">Searching…</p>}
        {!searching && term && !shown.length && <p className="px-3 py-2 text-xs text-ink-faint">No match found.</p>}
        {!term && <p className="px-3 py-2 text-xs text-ink-faint">Start typing to search…</p>}
        {shown.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => pick(c)}
            className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-surface-2"
          >
            <span className="font-medium">{c.query_no}</span> · {c.quotation_no} · {c.party_name}
            <span className="block text-[11px] text-ink-faint">Status: {c.status}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
