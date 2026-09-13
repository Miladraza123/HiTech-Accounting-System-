import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { toExclusiveUpperBound } from "@/lib/dashboardHelpers";
import { parsePage, pageRange, totalPages as computeTotalPages } from "@/lib/pagination";
import { PaginationControls } from "@/components/PaginationControls";
import { buttonClass } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { QuotationsTable } from "@/components/QuotationsTable";
import { FileText } from "lucide-react";

export default async function QuotationsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; status?: string; page?: string }>;
}) {
  const { from, to, status, page: pageParam } = await searchParams;
  const page = parsePage(pageParam);
  const [rangeFrom, rangeTo] = pageRange(page);

  const supabase = await createClient();
  let query = supabase
    .from("quotations")
    .select("*, parties(legal_name), quotation_revisions(rev_no, grand_total, is_current)", { count: "exact" })
    .order("created_at", { ascending: false });
  if (from && to) query = query.gte("created_at", from).lt("created_at", toExclusiveUpperBound(to));
  if (status) query = query.eq("status", status);
  const { data: quotations, count } = await query.range(rangeFrom, rangeTo);
  const totalPages = computeTotalPages(count ?? 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Quotations</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Every Quotation is linked to a Query, with revision history.
          {(from && to) || status ? (
            <>
              {" "}
              — filtered{" "}
              <Link href="/quotations" className="text-accent-ink underline underline-offset-2">
                (view all)
              </Link>
            </>
          ) : null}
        </p>
      </div>

      {quotations?.length ? (
        <QuotationsTable
          quotations={quotations.map((q) => {
            const revs = q.quotation_revisions as unknown as { rev_no: number; grand_total: number; is_current: boolean }[];
            const current = revs.find((r) => r.is_current) ?? revs[0];
            return {
              id: q.id,
              quotation_no: q.quotation_no,
              status: q.status,
              parties: q.parties as unknown as { legal_name: string } | null,
              currentRev: current?.rev_no ?? 0,
              currentTotal: current?.grand_total ?? 0,
            };
          })}
        />
      ) : (
        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <EmptyState
            icon={<FileText size={22} />}
            title="No quotations yet"
            description="A Quotation is created by linking to a Query — open a Query first and create the quotation from there."
            action={
              <Link href="/queries" className={buttonClass("secondary")}>
                View Queries
              </Link>
            }
          />
        </div>
      )}

      <PaginationControls basePath="/quotations" searchParams={{ from, to, status }} currentPage={page} totalPages={totalPages} totalCount={count ?? 0} />
    </div>
  );
}
