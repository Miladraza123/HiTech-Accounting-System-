import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { computeHealth, HEALTH_LABEL_TEXT, HEALTH_BADGE_STYLE } from "@/lib/orderHealth";

const STATUS_STYLE: Record<string, string> = {
  MaterialPending: "bg-warn-soft text-warn",
  MaterialAvailable: "bg-ledger-soft text-ledger",
  FabricationStarted: "bg-accent-soft text-accent-ink",
  InProcess: "bg-accent-soft text-accent-ink",
  ReadyForDispatch: "bg-good-soft text-good",
  Delivered: "bg-good-soft text-good",
  Cancelled: "bg-bad-soft text-bad",
};

const STATUS_LABEL: Record<string, string> = {
  MaterialPending: "Material Pending",
  MaterialAvailable: "Material Available",
  FabricationStarted: "Fabrication Started",
  InProcess: "In Process",
  ReadyForDispatch: "Ready for Dispatch",
  Delivered: "Delivered",
  Cancelled: "Cancelled",
};

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ status?: string; health?: string }> }) {
  const user = await getCurrentUser();
  const canCreate = await hasPermission(user, "job.manage");
  const { status: statusFilter, health: healthFilter } = await searchParams;

  const supabase = await createClient();
  let query = supabase
    .from("jobs")
    .select("*, sales_orders(so_no, parties(legal_name)), warehouses(name)")
    .order("created_at", { ascending: false });
  if (statusFilter) query = query.eq("status", statusFilter);
  const { data: allJobs } = await query;

  // "health" is computed per-row (not a DB column), so that filter is applied after the fetch.
  const jobs = healthFilter
    ? (allJobs ?? []).filter((j) => {
        const health = computeHealth({
          isOpen: !["Delivered", "Cancelled"].includes(j.status),
          promisedDate: j.required_delivery_date,
          updatedAt: j.updated_at,
        });
        if (healthFilter === "attention") return health?.label === "AtRisk" || health?.label === "Stalled";
        return health?.label === healthFilter;
      })
    : allJobs;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink">Jobs / Work Orders</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Fabrication — material reservation, issue, progress aur dispatch tak.
            {statusFilter || healthFilter ? (
              <>
                {" "}
                — filtered{" "}
                <Link href="/jobs" className="text-accent-ink underline underline-offset-2">
                  (sab dekhen)
                </Link>
              </>
            ) : null}
          </p>
        </div>
        {canCreate && (
          <Link href="/jobs/new" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition">
            + Nayi Job
          </Link>
        )}
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-4 py-2.5">Job #</th>
                <th className="text-left px-4 py-2.5">Client / SO</th>
                <th className="text-left px-4 py-2.5">Description</th>
                <th className="text-right px-4 py-2.5">Qty</th>
                <th className="text-right px-4 py-2.5">Progress</th>
                <th className="text-left px-4 py-2.5">Warehouse</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-left px-4 py-2.5">Health</th>
              </tr>
            </thead>
            <tbody>
              {(jobs ?? []).map((j) => {
                const so = j.sales_orders as unknown as { so_no: string; parties: { legal_name: string } | null } | null;
                const wh = j.warehouses as unknown as { name: string } | null;
                const health = computeHealth({
                  isOpen: !["Delivered", "Cancelled"].includes(j.status),
                  promisedDate: j.required_delivery_date,
                  updatedAt: j.updated_at,
                });
                return (
                  <tr key={j.id} className="border-t border-line hover:bg-surface-2">
                    <td className="px-4 py-2.5">
                      <Link href={`/jobs/${j.id}`} className="text-accent-ink underline underline-offset-2 font-mono text-xs">
                        {j.job_no}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft text-xs whitespace-nowrap">
                      {so?.parties?.legal_name} <span className="text-ink-faint">({so?.so_no})</span>
                    </td>
                    <td className="px-4 py-2.5 text-ink">{j.description}</td>
                    <td className="px-4 py-2.5 text-right tabular text-ink-soft">{j.job_qty}</td>
                    <td className="px-4 py-2.5 text-right tabular text-ink-soft">{j.progress_pct}%</td>
                    <td className="px-4 py-2.5 text-ink-soft text-xs whitespace-nowrap">{wh?.name ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[j.status] ?? ""}`}>{STATUS_LABEL[j.status] ?? j.status}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      {health && (
                        <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${HEALTH_BADGE_STYLE[health.label]}`} title={health.reason}>
                          {HEALTH_LABEL_TEXT[health.label]}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!jobs?.length && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-ink-faint">
                    Koi Job nahi hai abhi tak.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
