import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";

export default async function DailyLedgerPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "accounts") || hasRole(user, "auditor"))) redirect("/");

  const { date } = await searchParams;
  const selectedDate = date || new Date().toISOString().slice(0, 10);

  const supabase = await createClient();
  const { data: entries } = await supabase
    .from("journal_entries")
    .select("*, journal_lines(*, chart_of_accounts(code, name), parties(legal_name))")
    .eq("entry_date", selectedDate)
    .order("created_at");

  let dayDebit = 0;
  let dayCredit = 0;
  for (const e of entries ?? []) {
    const lines = e.journal_lines as unknown as { debit: number; credit: number }[];
    for (const l of lines) {
      dayDebit += l.debit;
      dayCredit += l.credit;
    }
  }

  const prevDate = new Date(selectedDate);
  prevDate.setDate(prevDate.getDate() - 1);
  const nextDate = new Date(selectedDate);
  nextDate.setDate(nextDate.getDate() + 1);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/reports" className="text-xs text-ink-faint hover:text-ink">
          ← Reports
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">Daily Ledger / Day Book</h1>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Link href={`/reports/daily-ledger?date=${prevDate.toISOString().slice(0, 10)}`} className="rounded-md border border-line-strong bg-bg px-3 py-1.5 text-xs text-ink hover:bg-surface-2 transition">
          ← Pichla din
        </Link>
        <form className="flex items-center gap-2">
          <input type="date" name="date" defaultValue={selectedDate} className="input !py-1.5 text-xs" />
          <button type="submit" className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition">
            Jayen
          </button>
        </form>
        <Link href={`/reports/daily-ledger?date=${nextDate.toISOString().slice(0, 10)}`} className="rounded-md border border-line-strong bg-bg px-3 py-1.5 text-xs text-ink hover:bg-surface-2 transition">
          Agla din →
        </Link>
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-3 py-2">Entry #</th>
                <th className="text-left px-3 py-2">Narration</th>
                <th className="text-left px-3 py-2">Account</th>
                <th className="text-left px-3 py-2">Party</th>
                <th className="text-right px-3 py-2">Debit</th>
                <th className="text-right px-3 py-2">Credit</th>
              </tr>
            </thead>
            <tbody>
              {(entries ?? []).map((e) => {
                const lines = e.journal_lines as unknown as {
                  id: string;
                  debit: number;
                  credit: number;
                  memo: string | null;
                  chart_of_accounts: { code: string; name: string } | null;
                  parties: { legal_name: string } | null;
                }[];
                return lines.map((l, idx) => (
                  <tr key={l.id} className="border-t border-line">
                    {idx === 0 && (
                      <td className="px-3 py-2 font-mono text-xs text-ink align-top" rowSpan={lines.length}>
                        {e.entry_no}
                      </td>
                    )}
                    {idx === 0 && (
                      <td className="px-3 py-2 text-ink-soft text-xs align-top" rowSpan={lines.length}>
                        {e.narration}
                      </td>
                    )}
                    <td className="px-3 py-2 text-ink">
                      {l.chart_of_accounts?.code} — {l.chart_of_accounts?.name}
                      {l.memo && <span className="block text-[11px] text-ink-faint">{l.memo}</span>}
                    </td>
                    <td className="px-3 py-2 text-ink-soft text-xs">{l.parties?.legal_name ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular text-ink">{l.debit > 0 ? l.debit.toLocaleString() : ""}</td>
                    <td className="px-3 py-2 text-right tabular text-ink">{l.credit > 0 ? l.credit.toLocaleString() : ""}</td>
                  </tr>
                ));
              })}
              {!entries?.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-ink-faint">
                    Is din koi journal entry nahi hai.
                  </td>
                </tr>
              )}
            </tbody>
            {!!entries?.length && (
              <tfoot>
                <tr className="border-t-2 border-line-strong bg-surface-2 font-semibold text-ink">
                  <td colSpan={4} className="px-3 py-2 text-right text-xs uppercase tracking-wide">
                    Day Total
                  </td>
                  <td className="px-3 py-2 text-right tabular">{dayDebit.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular">{dayCredit.toLocaleString()}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
