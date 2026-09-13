"use client";

import Link from "next/link";
import { useBulkSelection } from "@/lib/useBulkSelection";
import { downloadCsv } from "@/lib/csvExport";
import { buttonClass } from "@/components/ui/Button";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

const STATUS_TONE: Record<string, BadgeTone> = {
  Draft: "neutral",
  Sent: "warn",
  Accepted: "good",
  Rejected: "bad",
  Expired: "bad",
};

type QuotationRow = {
  id: string;
  quotation_no: string;
  status: string;
  parties: { legal_name: string } | null;
  currentRev: number;
  currentTotal: number;
};

/** Quotations list table with bulk select -> Export (CSV). No bulk cancel here — a Quotation's status/revision workflow is meant to be reviewed one at a time. */
export function QuotationsTable({ quotations }: { quotations: QuotationRow[] }) {
  const { selected, selectedRows, allSelected, toggle, toggleAll, clear } = useBulkSelection(quotations);

  function exportSelected() {
    downloadCsv(
      `quotations-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Quotation #", "Client", "Rev", "Total", "Status"],
      selectedRows.map((q) => [q.quotation_no, q.parties?.legal_name ?? "", q.currentRev, q.currentTotal, q.status])
    );
  }

  return (
    <div className="space-y-3">
      {selected.size > 0 && (
        <div className="rounded-xl border border-line bg-surface p-3 flex flex-wrap items-center gap-3">
          <span className="text-sm text-ink">{selected.size} selected</span>
          <button type="button" onClick={exportSelected} className={buttonClass("secondary", "sm")}>
            Export Selected (CSV)
          </button>
          <button type="button" onClick={clear} className="text-xs text-ink-faint underline underline-offset-2">
            Clear selection
          </button>
        </div>
      )}

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="px-4 py-2.5 w-8">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-3.5 w-3.5 accent-[var(--accent)]" aria-label="Select all" />
                </th>
                <th className="text-left px-4 py-2.5">Quotation #</th>
                <th className="text-left px-4 py-2.5">Client</th>
                <th className="text-left px-4 py-2.5">Rev</th>
                <th className="text-right px-4 py-2.5">Total</th>
                <th className="text-left px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {quotations.map((q) => (
                <tr key={q.id} className="border-t border-line even:bg-bg hover:bg-surface-2">
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={selected.has(q.id)}
                      onChange={() => toggle(q.id)}
                      className="h-3.5 w-3.5 accent-[var(--accent)]"
                      aria-label={`Select ${q.quotation_no}`}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <Link href={`/quotations/${q.id}`} className="text-accent-ink underline underline-offset-2 font-mono text-xs">
                      {q.quotation_no}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-ink whitespace-nowrap">{q.parties?.legal_name ?? "—"}</td>
                  <td className="px-4 py-2.5 text-ink-soft font-mono text-xs">Rev-{q.currentRev}</td>
                  <td className="px-4 py-2.5 text-right tabular text-ink">{q.currentTotal}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={STATUS_TONE[q.status] ?? "neutral"}>{q.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
