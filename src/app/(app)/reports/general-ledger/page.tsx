import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { parsePage, pageRange, totalPages as computeTotalPages, DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { PaginationControls } from "@/components/PaginationControls";

export default async function GeneralLedgerPage({ searchParams }: { searchParams: Promise<{ code?: string; page?: string }> }) {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "accounts") || hasRole(user, "auditor"))) redirect("/");

  const { code, page: pageParam } = await searchParams;
  const page = parsePage(pageParam);
  const [rangeFrom] = pageRange(page);

  const supabase = await createClient();
  const { data: accounts } = await supabase.from("chart_of_accounts").select("code, name, account_type").eq("is_active", true).order("code");

  // Was: fetch every line ever posted to this account and accumulate the
  // running balance here. An account like Bank or Sales collects a line from
  // every transaction the business ever makes, so that set only ever grows.
  // fn_account_ledger computes the running balance with a window function and
  // returns just this page — the full-history scan stays inside the database.
  let rowsWithBalance: { entry_date: string; narration: string; debit: number; credit: number; memo: string | null; running: number }[] = [];
  let totalDebit = 0;
  let totalCredit = 0;
  let totalRows = 0;
  if (code) {
    const { data: account } = await supabase.from("chart_of_accounts").select("id").eq("code", code).maybeSingle();
    if (account) {
      const { data: ledger } = await supabase.rpc("fn_account_ledger", {
        p_account_id: account.id,
        p_limit: DEFAULT_PAGE_SIZE,
        p_offset: rangeFrom,
      });
      rowsWithBalance = ledger ?? [];
      // Every row carries the same whole-ledger totals, so read them once.
      totalDebit = ledger?.[0]?.total_debit ?? 0;
      totalCredit = ledger?.[0]?.total_credit ?? 0;
      totalRows = ledger?.[0]?.total_rows ?? 0;
    }
  }
  const totalPages = computeTotalPages(totalRows);

  const selectedAccount = accounts?.find((a) => a.code === code);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/reports" className="text-xs text-ink-faint hover:text-ink">
          ← Reports
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">General Ledger</h1>
      </div>

      <form className="flex items-center gap-2 flex-wrap">
        <select name="code" defaultValue={code ?? ""} className="input !py-1.5 text-sm max-w-sm">
          <option value="">— Select Account —</option>
          {(accounts ?? []).map((a) => (
            <option key={a.code} value={a.code}>
              {a.code} — {a.name}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition">
          View
        </button>
      </form>

      {selectedAccount && (
        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="px-4 py-2.5 border-b border-line flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink font-mono">
              {selectedAccount.code} — {selectedAccount.name}
            </h2>
            <span className="text-xs text-ink-faint tabular">
              Dr {totalDebit.toLocaleString()} / Cr {totalCredit.toLocaleString()} / Balance {(totalDebit - totalCredit).toLocaleString()}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="text-left px-3 py-2">Date</th>
                  <th className="text-left px-3 py-2">Narration</th>
                  <th className="text-right px-3 py-2">Debit</th>
                  <th className="text-right px-3 py-2">Credit</th>
                  <th className="text-right px-3 py-2">Running Balance</th>
                </tr>
              </thead>
              <tbody>
                {rowsWithBalance.map((r, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="px-3 py-2 text-ink-faint text-xs">{r.entry_date}</td>
                    <td className="px-3 py-2 text-ink-soft">
                      {r.narration}
                      {r.memo && <span className="block text-[11px] text-ink-faint">{r.memo}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular text-ink">{r.debit > 0 ? r.debit.toLocaleString() : ""}</td>
                    <td className="px-3 py-2 text-right tabular text-ink">{r.credit > 0 ? r.credit.toLocaleString() : ""}</td>
                    <td className="px-3 py-2 text-right tabular text-ink-soft">{r.running.toLocaleString()}</td>
                  </tr>
                ))}
                {!rowsWithBalance.length && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-ink-faint">
                      No entries for this account.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="px-3 pb-3">
            <PaginationControls
              basePath="/reports/general-ledger"
              searchParams={{ code }}
              currentPage={page}
              totalPages={totalPages}
              totalCount={totalRows}
            />
          </div>
        </div>
      )}
    </div>
  );
}
