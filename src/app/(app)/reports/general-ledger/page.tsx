import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";

export default async function GeneralLedgerPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "accounts") || hasRole(user, "auditor"))) redirect("/");

  const { code } = await searchParams;

  const supabase = await createClient();
  const { data: accounts } = await supabase.from("chart_of_accounts").select("code, name, account_type").eq("is_active", true).order("code");

  let rows: { entry_date: string; narration: string; debit: number; credit: number; memo: string | null }[] = [];
  if (code) {
    const { data: account } = await supabase.from("chart_of_accounts").select("id").eq("code", code).maybeSingle();
    if (account) {
      const { data: lines } = await supabase
        .from("journal_lines")
        .select("debit, credit, memo, journal_entries!inner(entry_date, narration)")
        .eq("account_id", account.id);
      rows = (lines ?? [])
        .map((l) => {
          const je = l.journal_entries as unknown as { entry_date: string; narration: string };
          return { entry_date: je.entry_date, narration: je.narration, debit: l.debit, credit: l.credit, memo: l.memo };
        })
        .sort((a, b) => a.entry_date.localeCompare(b.entry_date));
    }
  }

  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  const rowsWithBalance = rows.reduce<(typeof rows[number] & { running: number })[]>((acc, r) => {
    const prev = acc.length ? acc[acc.length - 1].running : 0;
    acc.push({ ...r, running: prev + r.debit - r.credit });
    return acc;
  }, []);

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
                {!rows.length && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-ink-faint">
                      No entries for this account.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
