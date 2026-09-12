import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { computeHealth, daysSince, HEALTH_LABEL_TEXT, HEALTH_BADGE_STYLE, type HealthLabel } from "@/lib/orderHealth";

const HEALTH_RANK: Record<HealthLabel, number> = { Delayed: 0, Stalled: 1, AtRisk: 2, OnTrack: 3 };

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
  const [{ data: salesOrders }, { data: purchaseOrders }, { data: jobs }] = await Promise.all([
    supabase.from("sales_orders").select("id, so_no, status, delivery_schedule, updated_at, parties(legal_name)").not("status", "in", "(Delivered,Invoiced,Closed,Cancelled)"),
    supabase.from("purchase_orders").select("id, po_no, status, expected_delivery, updated_at, parties(legal_name)").not("status", "in", "(Received,Closed,Cancelled)"),
    supabase
      .from("jobs")
      .select("id, job_no, status, required_delivery_date, updated_at, sales_orders(parties(legal_name))")
      .not("status", "in", "(Delivered,Cancelled)"),
  ]);

  function buildRows<T extends { id: string; status: string; updated_at: string }>(
    items: T[],
    map: (t: T) => { docNo: string; href: string; partyName: string; promisedDate: string | null }
  ): Row[] {
    return items
      .map((t) => {
        const extra = map(t);
        const health = computeHealth({ isOpen: true, promisedDate: extra.promisedDate, updatedAt: t.updated_at });
        return { id: t.id, docNo: extra.docNo, href: extra.href, partyName: extra.partyName, status: t.status, promisedDate: extra.promisedDate, daysInStage: daysSince(t.updated_at), health };
      })
      .sort((a, b) => {
        const rankDiff = HEALTH_RANK[(a.health?.label ?? "OnTrack")] - HEALTH_RANK[(b.health?.label ?? "OnTrack")];
        return rankDiff !== 0 ? rankDiff : b.daysInStage - a.daysInStage;
      });
  }

  const soRows = buildRows(salesOrders ?? [], (s) => ({
    docNo: s.so_no,
    href: `/sales-orders/${s.id}`,
    partyName: (s.parties as unknown as { legal_name: string } | null)?.legal_name ?? "—",
    promisedDate: s.delivery_schedule,
  }));

  const poRows = buildRows(purchaseOrders ?? [], (p) => ({
    docNo: p.po_no,
    href: `/purchase-orders/${p.id}`,
    partyName: (p.parties as unknown as { legal_name: string } | null)?.legal_name ?? "—",
    promisedDate: p.expected_delivery,
  }));

  const jobRows = buildRows(jobs ?? [], (j) => ({
    docNo: j.job_no,
    href: `/jobs/${j.id}`,
    partyName: (j.sales_orders as unknown as { parties: { legal_name: string } | null } | null)?.parties?.legal_name ?? "—",
    promisedDate: j.required_delivery_date,
  }));

  const allRows = [...soRows, ...poRows, ...jobRows];
  const delayedCount = allRows.filter((r) => r.health?.label === "Delayed").length;
  const atRiskCount = allRows.filter((r) => r.health?.label === "AtRisk").length;
  const stalledCount = allRows.filter((r) => r.health?.label === "Stalled").length;

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

      <HealthTable title="Sales Orders" rows={soRows} />
      <HealthTable title="Purchase Orders" rows={poRows} />
      <HealthTable title="Jobs" rows={jobRows} />
    </div>
  );
}

function HealthTable({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      <div className="px-4 py-2.5 border-b border-line">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
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
