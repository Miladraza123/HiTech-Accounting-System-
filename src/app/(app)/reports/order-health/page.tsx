import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { computeHealth, daysSince, HEALTH_LABEL_TEXT, HEALTH_BADGE_STYLE } from "@/lib/orderHealth";

// How many rows of each kind the tables show. This is a worst-first list, so
// the interesting rows are always at the top; the header of each table still
// reports the true open total behind it.
const ROWS_PER_TABLE = 50;

type ApiRow = {
  id: string;
  doc_no: string;
  party_name: string;
  status: string;
  promised_date: string | null;
  updated_at: string;
};

type Section = { total: number; rows: ApiRow[] };

type Row = {
  id: string;
  docNo: string;
  href: string;
  partyName: string;
  status: string;
  promisedDate: string | null;
  daysInStage: number;
  health: ReturnType<typeof computeHealth>;
};

export default async function OrderHealthReportPage() {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "accounts") || hasRole(user, "auditor"))) redirect("/");

  const supabase = await createClient();
  // This page used to fetch every open Sales Order, Purchase Order and Job
  // with its party embed and rank them here. On a book of 60,000 open orders
  // and 100,000 open jobs that is 16.5 MB of JSON per view and a
  // hundred-thousand-row HTML table. fn_order_health does the ranking and the
  // counting in the database and returns only the worst rows of each kind --
  // 21 KB instead of 16.5 MB, measured on that same data.
  const { data } = await supabase.rpc("fn_order_health", { p_limit: ROWS_PER_TABLE });
  const result = (data ?? null) as {
    delayed_count: number;
    at_risk_count: number;
    stalled_count: number;
    sales_orders: Section;
    purchase_orders: Section;
    jobs: Section;
  } | null;

  const empty: Section = { total: 0, rows: [] };
  const soSection = result?.sales_orders ?? empty;
  const poSection = result?.purchase_orders ?? empty;
  const jobSection = result?.jobs ?? empty;

  // The badge and its tooltip keep their single definition in computeHealth(),
  // so what the database ranked by and what the page prints cannot drift apart
  // into two different rules. Only the rows actually shown are converted.
  function toRows(rows: ApiRow[], hrefBase: string): Row[] {
    return rows.map((r) => ({
      id: r.id,
      docNo: r.doc_no,
      href: `${hrefBase}/${r.id}`,
      partyName: r.party_name,
      status: r.status,
      promisedDate: r.promised_date,
      daysInStage: daysSince(r.updated_at),
      health: computeHealth({ isOpen: true, promisedDate: r.promised_date, updatedAt: r.updated_at }),
    }));
  }

  const soRows = toRows(soSection.rows ?? [], "/sales-orders");
  const poRows = toRows(poSection.rows ?? [], "/purchase-orders");
  const jobRows = toRows(jobSection.rows ?? [], "/jobs");

  const delayedCount = result?.delayed_count ?? 0;
  const atRiskCount = result?.at_risk_count ?? 0;
  const stalledCount = result?.stalled_count ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/reports" className="text-xs text-ink-faint hover:text-ink">
          ← Reports
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">Order Health &amp; Stage Aging</h1>
        <p className="text-sm text-ink-soft">Health flag and days in current stage for every open Sales Order / Purchase Order / Job.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className={`text-2xl font-semibold tabular ${delayedCount > 0 ? "text-bad" : "text-ink"}`}>{delayedCount}</p>
          <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Delayed (Past Promised Date)</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className={`text-2xl font-semibold tabular ${atRiskCount > 0 ? "text-warn" : "text-ink"}`}>{atRiskCount}</p>
          <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">At Risk (Promised Date Approaching)</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className={`text-2xl font-semibold tabular ${stalledCount > 0 ? "text-warn" : "text-ink"}`}>{stalledCount}</p>
          <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Stalled (No Progress for 10+ Days)</p>
        </div>
      </div>

      <HealthTable title="Sales Orders" rows={soRows} total={soSection.total ?? 0} />
      <HealthTable title="Purchase Orders" rows={poRows} total={poSection.total ?? 0} />
      <HealthTable title="Jobs" rows={jobRows} total={jobSection.total ?? 0} />
    </div>
  );
}

function HealthTable({ title, rows, total }: { title: string; rows: Row[]; total: number }) {
  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      <div className="px-4 py-2.5 border-b border-line flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <p className="text-xs text-ink-faint font-mono">
          {total > rows.length ? `Worst ${rows.length} of ${total.toLocaleString()} open` : `${total.toLocaleString()} open`}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
            <tr>
              <th className="text-left px-3 py-2">Doc #</th>
              <th className="text-left px-3 py-2">Party</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Promised Date</th>
              <th className="text-right px-3 py-2">Days in Stage</th>
              <th className="text-left px-3 py-2">Health</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="px-3 py-2 font-mono text-xs text-ink">
                  <Link href={r.href} className="text-accent-ink underline underline-offset-2">
                    {r.docNo}
                  </Link>
                </td>
                <td className="px-3 py-2 text-ink-soft">{r.partyName}</td>
                <td className="px-3 py-2 text-ink-soft text-xs">{r.status}</td>
                <td className="px-3 py-2 text-ink-faint text-xs">{r.promisedDate ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular text-ink-soft">{r.daysInStage}</td>
                <td className="px-3 py-2">
                  {r.health && (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${HEALTH_BADGE_STYLE[r.health.label]}`} title={r.health.reason}>
                      {HEALTH_LABEL_TEXT[r.health.label]}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-ink-faint">
                  No open records found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
