import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { toExclusiveUpperBound } from "@/lib/dashboardHelpers";
import { parsePage, pageRange, totalPages as computeTotalPages } from "@/lib/pagination";
import { PaginationControls } from "@/components/PaginationControls";
import { buttonClass } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { QueriesTable } from "@/components/QueriesTable";
import { HelpCircle } from "lucide-react";

export default async function QueriesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; page?: string }>;
}) {
  const user = await getCurrentUser();
  const canCreate = await hasPermission(user, "query.manage");
  const { from, to, page: pageParam } = await searchParams;
  const page = parsePage(pageParam);
  const [rangeFrom, rangeTo] = pageRange(page);

  const supabase = await createClient();
  let query = supabase
    .from("queries")
    .select("*, parties(legal_name)", { count: "exact" })
    .order("created_at", { ascending: false });
  if (from && to) query = query.gte("created_at", from).lt("created_at", toExclusiveUpperBound(to));
  const { data: queries, count } = await query.range(rangeFrom, rangeTo);
  const totalPages = computeTotalPages(count ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink">Queries</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Every new client inquiry starts here.
            {from && to && (
              <>
                {" "}
                — from <span className="text-ink">{from}</span> to <span className="text-ink">{to}</span>{" "}
                <Link href="/queries" className="text-accent-ink underline underline-offset-2">
                  (view all)
                </Link>
              </>
            )}
          </p>
        </div>
        {canCreate && (
          <Link href="/queries/new" className={buttonClass()}>
            + New Query
          </Link>
        )}
      </div>

      {queries?.length ? (
        <QueriesTable queries={queries.map((q) => ({ ...q, parties: q.parties as unknown as { legal_name: string } | null }))} />
      ) : (
        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <EmptyState
            icon={<HelpCircle size={22} />}
            title="No queries yet"
            description="Every new client inquiry is recorded here — start by adding your first query."
            action={
              canCreate ? (
                <Link href="/queries/new" className={buttonClass()}>
                  + New Query
                </Link>
              ) : undefined
            }
          />
        </div>
      )}

      <PaginationControls basePath="/queries" searchParams={{ from, to }} currentPage={page} totalPages={totalPages} totalCount={count ?? 0} />
    </div>
  );
}
