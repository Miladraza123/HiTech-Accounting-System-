import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { buttonClass } from "@/components/ui/Button";
import { parsePage, pageRange, totalPages as computeTotalPages } from "@/lib/pagination";
import { PaginationControls } from "@/components/PaginationControls";

export default async function JournalVouchersPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await getCurrentUser();
  const canView = isOwner(user) || hasRole(user, "accounts") || hasRole(user, "auditor");
  if (!canView) redirect("/");
  const canCreate = await hasPermission(user, "journal_voucher.manage");

  const { page: pageParam } = await searchParams;
  const page = parsePage(pageParam);
  const [rangeFrom, rangeTo] = pageRange(page);

  const supabase = await createClient();
  // Was `.limit(100)` with no paging — that capped the screen at the 100 most
  // recent vouchers, so older ones were unreachable entirely. Real pagination
  // both bounds each request and makes the full history reachable.
  const { data: entries, count } = await supabase
    .from("journal_entries")
    .select("*, journal_lines(*, chart_of_accounts(code, name))", { count: "exact" })
    .eq("source_table", "manual")
    .order("entry_date", { ascending: false })
    .range(rangeFrom, rangeTo);
  const totalPages = computeTotalPages(count ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink">Journal Vouchers</h1>
          <p className="mt-1 text-sm text-ink-soft">Manual entries — those not created automatically by the Payment/Expense/Transfer screens.</p>
        </div>
        {canCreate && (
          <Link href="/journal-vouchers/new" className={buttonClass()}>
            + New Journal Voucher
          </Link>
        )}
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-3 py-2">Entry #</th>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-left px-3 py-2">Narration</th>
                <th className="text-right px-3 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {(entries ?? []).map((e) => {
                const lines = e.journal_lines as unknown as { debit: number; credit: number }[];
                const total = lines.reduce((s, l) => s + l.debit, 0);
                return (
                  <tr key={e.id} className="border-t border-line">
                    <td className="px-3 py-2 font-mono text-xs text-ink">{e.entry_no}</td>
                    <td className="px-3 py-2 text-ink-faint text-xs">{e.entry_date}</td>
                    <td className="px-3 py-2 text-ink-soft">{e.narration}</td>
                    <td className="px-3 py-2 text-right tabular text-ink">{total.toLocaleString()}</td>
                  </tr>
                );
              })}
              {!entries?.length && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-ink-faint">
                    No manual Journal Voucher created yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PaginationControls basePath="/journal-vouchers" searchParams={{}} currentPage={page} totalPages={totalPages} totalCount={count ?? 0} />

      <p className="text-xs text-ink-faint">
        All transactions (manual + automatic) for a day can be viewed in the{" "}
        <Link href="/reports/daily-ledger" className="text-accent-ink underline underline-offset-2">
          Daily Ledger
        </Link>
        .
      </p>
    </div>
  );
}
