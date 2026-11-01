import { parseSnapshot } from "@/lib/poEdit";

export type PoRevisionRow = {
  id: string;
  rev_no: number; // the version this row preserves
  summary: string;
  reason: string | null;
  changed_at: string;
  changed_by_name: string;
  snapshot: unknown;
};

function fmt(ts: string) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Karachi" });
}

/**
 * Revision history of a Purchase Order. Row `rev_no = k` holds the version k
 * exactly as it was before the edit that produced version k+1, so the newest
 * change is listed first and each entry can open the version it replaced.
 */
export function PurchaseOrderRevisions({ currentRevision, revisions }: { currentRevision: number; revisions: PoRevisionRow[] }) {
  if (revisions.length === 0) return null;
  const sorted = [...revisions].sort((a, b) => b.rev_no - a.rev_no);
  return (
    <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
      <h2 className="text-sm font-semibold text-ink">Revision History</h2>
      <p className="text-xs text-ink-faint">
        Current version: <span className="font-mono text-ink">Revision {currentRevision}</span>. Every edit keeps the version it replaced.
      </p>
      <ol className="space-y-3">
        {sorted.map((r) => {
          const snap = parseSnapshot(r.snapshot);
          return (
            <li key={r.id} className="rounded-lg border border-line bg-bg p-3 text-sm space-y-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-xs text-ink">Revision {r.rev_no + 1}</span>
                <span className="text-xs text-ink-faint">
                  {r.changed_by_name} · {fmt(r.changed_at)}
                </span>
              </div>
              <p className="text-ink-soft">{r.summary}</p>
              {r.reason && <p className="text-xs text-ink-faint">Reason: {r.reason}</p>}
              {snap && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-accent-ink underline underline-offset-2">View Revision {r.rev_no} (before this change)</summary>
                  <div className="mt-2 space-y-2">
                    <p className="text-ink-soft">
                      {snap.header.supplier_name}
                      {snap.header.warehouse_name ? ` · ${snap.header.warehouse_name}` : ""}
                      {snap.header.expected_delivery ? ` · expected ${snap.header.expected_delivery}` : ""}
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="font-mono uppercase text-ink-faint">
                          <tr>
                            <th className="text-left py-1 pr-3">Description</th>
                            <th className="text-right py-1 pr-3">Qty</th>
                            <th className="text-right py-1 pr-3">Rate</th>
                            <th className="text-right py-1">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {snap.lines.map((l) => (
                            <tr key={l.id} className="border-t border-line">
                              <td className="py-1 pr-3 text-ink">{l.description}</td>
                              <td className="py-1 pr-3 text-right tabular text-ink-soft">
                                {Number(l.ordered_qty)} {l.unit}
                              </td>
                              <td className="py-1 pr-3 text-right tabular text-ink-soft">{Number(l.rate)}</td>
                              <td className="py-1 text-right tabular text-ink">{l.amount ?? ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-right tabular text-ink">Total: {snap.header.grand_total}</p>
                  </div>
                </details>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
