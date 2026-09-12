import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { toExclusiveUpperBound } from "@/lib/dashboardHelpers";
import { parsePage, pageRange, totalPages as computeTotalPages } from "@/lib/pagination";
import { PaginationControls } from "@/components/PaginationControls";

const STATUS_STYLE: Record<string, string> = {
  Draft: "bg-surface-2 text-ink-faint",
  Sent: "bg-warn-soft text-warn",
  Accepted: "bg-good-soft text-good",
  Rejected: "bg-bad-soft text-bad",
  Expired: "bg-bad-soft text-bad",
};

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
          Har Quotation ek Query se link hoti hai, revision history ke sath.
          {(from && to) || status ? (
            <>
              {" "}
              — filtered{" "}
              <Link href="/quotations" className="text-accent-ink underline underline-offset-2">
                (sab dekhen)
              </Link>
            </>
          ) : null}
        </p>
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-4 py-2.5">Quotation #</th>
                <th className="text-left px-4 py-2.5">Client</th>
                <th className="text-left px-4 py-2.5">Rev</th>
                <th className="text-right px-4 py-2.5">Total</th>
                <th className="text-left px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {(quotations ?? []).map((q) => {
                const revs = q.quotation_revisions as unknown as { rev_no: number; grand_total: number; is_current: boolean }[];
                const current = revs.find((r) => r.is_current) ?? revs[0];
                return (
                  <tr key={q.id} className="border-t border-line hover:bg-surface-2">
                    <td className="px-4 py-2.5">
                      <Link href={`/quotations/${q.id}`} className="text-accent-ink underline underline-offset-2 font-mono text-xs">
                        {q.quotation_no}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-ink whitespace-nowrap">{(q.parties as unknown as { legal_name: string } | null)?.legal_name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-ink-soft font-mono text-xs">Rev-{current?.rev_no ?? 0}</td>
                    <td className="px-4 py-2.5 text-right tabular text-ink">{current?.grand_total ?? 0}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[q.status] ?? ""}`}>{q.status}</span>
                    </td>
                  </tr>
                );
              })}
              {!quotations?.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-ink-faint">
                    Koi quotation nahi hai abhi tak.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PaginationControls basePath="/quotations" searchParams={{ from, to, status }} currentPage={page} totalPages={totalPages} />
    </div>
  );
}
