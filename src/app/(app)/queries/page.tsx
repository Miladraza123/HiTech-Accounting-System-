import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { toExclusiveUpperBound } from "@/lib/dashboardHelpers";
import { parsePage, pageRange, totalPages as computeTotalPages } from "@/lib/pagination";
import { PaginationControls } from "@/components/PaginationControls";

const STATUS_STYLE: Record<string, string> = {
  Open: "bg-ledger-soft text-ledger",
  Quoted: "bg-warn-soft text-warn",
  Won: "bg-good-soft text-good",
  Lost: "bg-bad-soft text-bad",
  OnHold: "bg-surface-2 text-ink-faint",
};

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
            Har naya client inquiry yahan se shuru hota hai.
            {from && to && (
              <>
                {" "}
                — <span className="text-ink">{from}</span> se <span className="text-ink">{to}</span> tak{" "}
                <Link href="/queries" className="text-accent-ink underline underline-offset-2">
                  (sab dekhen)
                </Link>
              </>
            )}
          </p>
        </div>
        {canCreate && (
          <Link
            href="/queries/new"
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition"
          >
            + Nayi Query
          </Link>
        )}
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-4 py-2.5">Query #</th>
                <th className="text-left px-4 py-2.5">Client</th>
                <th className="text-left px-4 py-2.5">Requirement</th>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-4 py-2.5">Follow-up</th>
                <th className="text-left px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {(queries ?? []).map((q) => (
                <tr key={q.id} className="border-t border-line hover:bg-surface-2">
                  <td className="px-4 py-2.5">
                    <Link href={`/queries/${q.id}`} className="text-accent-ink underline underline-offset-2 font-mono text-xs">
                      {q.query_no}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-ink whitespace-nowrap">{(q.parties as unknown as { legal_name: string } | null)?.legal_name ?? "—"}</td>
                  <td className="px-4 py-2.5 text-ink-soft max-w-xs truncate">{q.requirement}</td>
                  <td className="px-4 py-2.5 text-ink-soft whitespace-nowrap">{q.query_date}</td>
                  <td className="px-4 py-2.5 text-ink-soft whitespace-nowrap">{q.next_followup_at ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[q.status] ?? ""}`}>{q.status}</span>
                  </td>
                </tr>
              ))}
              {!queries?.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-ink-faint">
                    Koi query nahi hai abhi tak.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PaginationControls basePath="/queries" searchParams={{ from, to }} currentPage={page} totalPages={totalPages} />
    </div>
  );
}
