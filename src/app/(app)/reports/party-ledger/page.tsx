import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { parsePage, pageRange, totalPages as computeTotalPages, DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { PaginationControls } from "@/components/PaginationControls";
import { SearchablePicker, PARTY_SOURCE } from "@/components/SearchablePicker";

export default async function PartyLedgerPage({ searchParams }: { searchParams: Promise<{ party_id?: string; page?: string }> }) {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "accounts") || hasRole(user, "auditor"))) redirect("/");

  const { party_id, page: pageParam } = await searchParams;
  const page = parsePage(pageParam);
  const [rangeFrom] = pageRange(page);

  const supabase = await createClient();
  // A first page of parties for the selector, plus the one already chosen —
  // the rest are found by typing, searched in the database. No is_active
  // filter, deliberately: a ledger must still be viewable for a party that
  // has since been deactivated, exactly as before.
  const [{ data: parties }, { data: selectedParty }] = await Promise.all([
    supabase.from("parties").select("id, legal_name, party_type").order("legal_name").limit(20),
    party_id
      ? supabase.from("parties").select("id, legal_name, party_type").eq("id", party_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Same change as the General Ledger: a long-standing client accumulates a
  // journal line per transaction forever, so the running balance is computed
  // in the database and only this page is returned.
  let rowsWithBalance: { entry_date: string; narration: string; debit: number; credit: number; memo: string | null; running: number }[] = [];
  let totalDebit = 0;
  let totalCredit = 0;
  let totalRows = 0;
  if (party_id) {
    const { data: ledger } = await supabase.rpc("fn_party_ledger", {
      p_party_id: party_id,
      p_limit: DEFAULT_PAGE_SIZE,
      p_offset: rangeFrom,
    });
    rowsWithBalance = ledger ?? [];
    totalDebit = ledger?.[0]?.total_debit ?? 0;
    totalCredit = ledger?.[0]?.total_credit ?? 0;
    totalRows = ledger?.[0]?.total_rows ?? 0;
  }
  const totalPages = computeTotalPages(totalRows);


  return (
    <div className="space-y-6">
      <div>
        <Link href="/reports" className="text-xs text-ink-faint hover:text-ink">
          ← Reports
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">Customer / Supplier Ledger</h1>
      </div>

      <form className="flex items-center gap-2 flex-wrap">
        <div className="w-full max-w-sm">
          <SearchablePicker
            name="party_id"
            source={PARTY_SOURCE}
            initialOptions={(parties ?? []).map((p) => ({ id: p.id, label: p.legal_name, hint: p.party_type }))}
            initialSelected={
              selectedParty
                ? { id: selectedParty.id, label: selectedParty.legal_name, hint: selectedParty.party_type }
                : null
            }
            placeholder="Type a customer or supplier name…"
          />
        </div>
        <button type="submit" className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition">
          View
        </button>
      </form>

      {selectedParty && (
        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="px-4 py-2.5 border-b border-line flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">{selectedParty.legal_name}</h2>
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
                      No ledger entries for this party.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="px-3 pb-3">
            <PaginationControls
              basePath="/reports/party-ledger"
              searchParams={{ party_id }}
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
