"use client";

import Link from "next/link";
import { useBulkSelection } from "@/lib/useBulkSelection";
import { downloadCsv } from "@/lib/csvExport";
import { buttonClass } from "@/components/ui/Button";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

const STATUS_TONE: Record<string, BadgeTone> = {
  Open: "ledger",
  Quoted: "warn",
  Won: "good",
  Lost: "bad",
  OnHold: "neutral",
};

type QueryRow = {
  id: string;
  query_no: string;
  requirement: string;
  query_date: string;
  next_followup_at: string | null;
  status: string;
  parties: { legal_name: string } | null;
};

/** Queries list table with bulk select -> Export (CSV). No bulk status change here — Query status is a workflow the team steps through deliberately one at a time, not something to batch-transition. */
export function QueriesTable({ queries }: { queries: QueryRow[] }) {
  const { selected, selectedRows, allSelected, toggle, toggleAll, clear } = useBulkSelection(queries);

  function exportSelected() {
    downloadCsv(
      `queries-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Query #", "Client", "Requirement", "Date", "Follow-up", "Status"],
      selectedRows.map((q) => [q.query_no, q.parties?.legal_name ?? "", q.requirement, q.query_date, q.next_followup_at ?? "", q.status])
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
                <th className="text-left px-4 py-2.5">Query #</th>
                <th className="text-left px-4 py-2.5">Client</th>
                <th className="text-left px-4 py-2.5">Requirement</th>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-4 py-2.5">Follow-up</th>
                <th className="text-left px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {queries.map((q) => (
                <tr key={q.id} className="border-t border-line even:bg-bg hover:bg-surface-2">
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={selected.has(q.id)}
                      onChange={() => toggle(q.id)}
                      className="h-3.5 w-3.5 accent-[var(--accent)]"
                      aria-label={`Select ${q.query_no}`}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <Link href={`/queries/${q.id}`} className="text-accent-ink underline underline-offset-2 font-mono text-xs">
                      {q.query_no}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-ink whitespace-nowrap">{q.parties?.legal_name ?? "—"}</td>
                  <td className="px-4 py-2.5 text-ink-soft max-w-xs truncate">{q.requirement}</td>
                  <td className="px-4 py-2.5 text-ink-soft whitespace-nowrap">{q.query_date}</td>
                  <td className="px-4 py-2.5 text-ink-soft whitespace-nowrap">{q.next_followup_at ?? "—"}</td>
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
