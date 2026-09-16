import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { computeHealth, HEALTH_LABEL_TEXT, HEALTH_BADGE_STYLE } from "@/lib/orderHealth";
import { parsePage, pageRange, totalPages as computeTotalPages, DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { PaginationControls } from "@/components/PaginationControls";
import { buttonClass } from "@/components/ui/Button";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Wrench } from "lucide-react";

const STATUS_TONE: Record<string, BadgeTone> = {
  MaterialPending: "warn",
  MaterialAvailable: "ledger",
  FabricationStarted: "accent",
  InProcess: "accent",
  ReadyForDispatch: "good",
  Delivered: "good",
  Cancelled: "bad",
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

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; health?: string; page?: string }>;
}) {
  const user = await getCurrentUser();
  const canCreate = await hasPermission(user, "job.manage");
  const { status: statusFilter, health: healthFilter, page: pageParam } = await searchParams;
  const page = parsePage(pageParam);

  const supabase = await createClient();
  const JOBS_SELECT = "*, sales_orders(so_no, parties(legal_name)), warehouses(name)";

  // "health" is computed from the clock rather than stored, so it is not a
  // column PostgREST can filter on. This page used to answer that by fetching
  // EVERY job with all of its embeds and filtering here -- 69.5 MB of JSON on
  // a 120,000-job book to render 25 rows. fn_jobs_by_health applies the same
  // rule in the database and returns just this page's ids plus the matching
  // total; the rows themselves are then loaded through the same select as the
  // unfiltered path, so the table and its embeds are identical either way.
  async function loadJobs() {
    if (healthFilter) {
      const [rangeFrom] = pageRange(page);
      const { data: idRows } = await supabase.rpc("fn_jobs_by_health", {
        p_status: statusFilter ?? "",
        p_health: healthFilter,
        p_limit: DEFAULT_PAGE_SIZE,
        p_offset: rangeFrom,
      });
      const ids = (idRows ?? []).map((r) => r.id);
      const total = idRows?.[0]?.total_rows ?? 0;
      const { data } = ids.length
        ? await supabase.from("jobs").select(JOBS_SELECT).in("id", ids).order("created_at", { ascending: false })
        : { data: [] };
      return { jobs: data ?? [], totalPages: computeTotalPages(total), total };
    }

    let pagedQuery = supabase
      .from("jobs")
      .select(JOBS_SELECT, { count: "exact" })
      .order("created_at", { ascending: false });
    if (statusFilter) pagedQuery = pagedQuery.eq("status", statusFilter);
    const [rangeFrom, rangeTo] = pageRange(page);
    const { data, count } = await pagedQuery.range(rangeFrom, rangeTo);
    return { jobs: data ?? [], totalPages: computeTotalPages(count ?? 0), total: count ?? 0 };
  }
  const { jobs, totalPages, total } = await loadJobs();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink">Jobs / Work Orders</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Fabrication — from material reservation and issue through progress to dispatch.
            {statusFilter || healthFilter ? (
              <>
                {" "}
                — filtered{" "}
                <Link href="/jobs" className="text-accent-ink underline underline-offset-2">
                  (view all)
                </Link>
              </>
            ) : null}
          </p>
        </div>
        {canCreate && (
          <Link href="/jobs/new" className={buttonClass()}>
            + New Job
          </Link>
        )}
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        {jobs.length ? (
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
                {jobs.map((j) => {
                  const so = j.sales_orders as unknown as { so_no: string; parties: { legal_name: string } | null } | null;
                  const wh = j.warehouses as unknown as { name: string } | null;
                  const health = computeHealth({
                    isOpen: !["Delivered", "Cancelled"].includes(j.status),
                    promisedDate: j.required_delivery_date,
                    updatedAt: j.updated_at,
                  });
                  return (
                    <tr key={j.id} className="border-t border-line even:bg-bg hover:bg-surface-2">
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
                        <Badge tone={STATUS_TONE[j.status] ?? "neutral"}>{STATUS_LABEL[j.status] ?? j.status}</Badge>
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
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<Wrench size={22} />}
            title="No active Jobs"
            description="Fabrication jobs are started here once a Sales Order is confirmed."
            action={
              canCreate ? (
                <Link href="/jobs/new" className={buttonClass()}>
                  + New Job
                </Link>
              ) : undefined
            }
          />
        )}
      </div>

      <PaginationControls
        basePath="/jobs"
        searchParams={{ status: statusFilter, health: healthFilter }}
        currentPage={page}
        totalPages={totalPages}
        totalCount={total}
      />
    </div>
  );
}
