import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { NewServiceJobForm } from "@/components/NewServiceJobForm";
import { parsePage, pageRange, totalPages as computeTotalPages } from "@/lib/pagination";
import { PaginationControls } from "@/components/PaginationControls";

const STATUS_STYLE: Record<string, string> = {
  Received: "bg-warn-soft text-warn",
  Completed: "bg-ledger-soft text-ledger",
  Delivered: "bg-good-soft text-good",
  Cancelled: "bg-bad-soft text-bad",
};

export default async function ServiceJobsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await getCurrentUser();
  const canManage = await hasPermission(user, "service_job.manage");

  const { page: pageParam } = await searchParams;
  const page = parsePage(pageParam);
  const [rangeFrom, rangeTo] = pageRange(page);

  const supabase = await createClient();
  const [{ data: jobs, count }, { data: clientParties }] = await Promise.all([
    supabase
      .from("service_jobs")
      .select("*, parties(legal_name)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(rangeFrom, rangeTo),
    canManage
      ? supabase.from("parties").select("id, legal_name").eq("is_active", true).in("party_type", ["client", "both"]).order("legal_name").limit(20)
      : Promise.resolve({ data: [] }),
  ]);
  const totalPages = computeTotalPages(count ?? 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Service Jobs</h1>
        <p className="mt-1 text-sm text-ink-soft">Repair/service work on customer-owned machines/parts — intake, delivery, and billing.</p>
      </div>

      {canManage && <NewServiceJobForm clientParties={clientParties ?? []} />}

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-4 py-2.5">Job #</th>
                <th className="text-left px-4 py-2.5">Client</th>
                <th className="text-left px-4 py-2.5">Asset</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-left px-4 py-2.5">Received</th>
              </tr>
            </thead>
            <tbody>
              {(jobs ?? []).map((j) => {
                const party = j.parties as unknown as { legal_name: string } | null;
                return (
                  <tr key={j.id} className="border-t border-line">
                    <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">
                      <Link href={`/service-jobs/${j.id}`} className="text-accent-ink underline underline-offset-2">
                        {j.job_no}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-ink whitespace-nowrap">{party?.legal_name}</td>
                    <td className="px-4 py-2.5 text-ink-soft max-w-xs truncate">{j.asset_description}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[j.status] ?? ""}`}>{j.status}</span>
                    </td>
                    <td className="px-4 py-2.5 text-ink-faint text-xs whitespace-nowrap">{new Date(j.created_at).toLocaleDateString("en-PK")}</td>
                  </tr>
                );
              })}
              {!jobs?.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-ink-faint">
                    No Service Jobs yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PaginationControls basePath="/service-jobs" searchParams={{}} currentPage={page} totalPages={totalPages} totalCount={count ?? 0} />
    </div>
  );
}
