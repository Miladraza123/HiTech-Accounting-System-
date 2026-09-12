import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";

const CASH_CODES = ["1050", "1100", "1060"];
const ACCOUNT_LABEL: Record<string, string> = { "1050": "Cash in Hand", "1100": "Bank Accounts", "1060": "Petty Cash" };

function defaultMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { from, to };
}

export default async function CashFlowPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "accounts") || hasRole(user, "auditor"))) redirect("/");

  const { from, to } = await searchParams;
  const defaults = defaultMonthRange();
  const fromDate = from || defaults.from;
  const toDate = to || defaults.to;

  const supabase = await createClient();

  const [{ data: openingEntries }, { data: periodEntries }] = await Promise.all([
    supabase
      .from("journal_entries")
      .select("journal_lines(debit, credit, chart_of_accounts(code))")
      .lt("entry_date", fromDate),
    supabase
      .from("journal_entries")
      .select("entry_date, narration, journal_lines(debit, credit, chart_of_accounts(code, name))")
      .gte("entry_date", fromDate)
      .lte("entry_date", toDate)
      .order("entry_date"),
  ]);

  type Line = { debit: number; credit: number; chart_of_accounts: { code: string; name?: string } | null };

  const openingByCode: Record<string, number> = { "1050": 0, "1100": 0, "1060": 0 };
  for (const e of openingEntries ?? []) {
    const lines = e.journal_lines as unknown as Line[];
    for (const l of lines) {
      const code = l.chart_of_accounts?.code;
      if (code && CASH_CODES.includes(code)) openingByCode[code] += l.debit - l.credit;
    }
  }

  const receiptsByCode: Record<string, number> = { "1050": 0, "1100": 0, "1060": 0 };
  const paymentsByCode: Record<string, number> = { "1050": 0, "1100": 0, "1060": 0 };
  const transactions: { date: string; narration: string; account: string; debit: number; credit: number }[] = [];

  for (const e of periodEntries ?? []) {
    const lines = e.journal_lines as unknown as Line[];
    for (const l of lines) {
      const code = l.chart_of_accounts?.code;
      if (!code || !CASH_CODES.includes(code)) continue;
      receiptsByCode[code] += l.debit;
      paymentsByCode[code] += l.credit;
      transactions.push({ date: e.entry_date, narration: e.narration ?? "", account: ACCOUNT_LABEL[code], debit: l.debit, credit: l.credit });
    }
  }

  const totalOpening = CASH_CODES.reduce((s, c) => s + openingByCode[c], 0);
  const totalReceipts = CASH_CODES.reduce((s, c) => s + receiptsByCode[c], 0);
  const totalPayments = CASH_CODES.reduce((s, c) => s + paymentsByCode[c], 0);
  const totalClosing = totalOpening + totalReceipts - totalPayments;

  const transactionsWithBalance = transactions.reduce<(typeof transactions[number] & { running: number })[]>((acc, t) => {
    const prev = acc.length ? acc[acc.length - 1].running : totalOpening;
    acc.push({ ...t, running: prev + t.debit - t.credit });
    return acc;
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/reports" className="text-xs text-ink-faint hover:text-ink">
          ← Reports
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">Cash Flow &amp; Position</h1>
        <p className="text-sm text-ink-soft">Cash in Hand + Bank Accounts + Petty Cash — combined Cash Book / Bank Book.</p>
      </div>

      <form className="flex items-center gap-2 flex-wrap">
        <label className="flex items-center gap-1.5 text-xs text-ink-soft">
          From
          <input type="date" name="from" defaultValue={fromDate} className="input !py-1.5 text-xs" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-ink-soft">
          To
          <input type="date" name="to" defaultValue={toDate} className="input !py-1.5 text-xs" />
        </label>
        <button type="submit" className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition">
          Apply
        </button>
        <Link href="/reports/cash-flow" className="text-xs text-ink-faint underline underline-offset-2">
          This Month
        </Link>
      </form>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Opening Balance</p>
          <p className="mt-1 text-xl font-semibold text-ink tabular">{totalOpening.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Total Receipts</p>
          <p className="mt-1 text-xl font-semibold text-good tabular">+{totalReceipts.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Total Payments</p>
          <p className="mt-1 text-xl font-semibold text-bad tabular">-{totalPayments.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-accent bg-accent-soft/30 p-4">
          <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Closing Balance</p>
          <p className="mt-1 text-xl font-semibold text-ink tabular">{totalClosing.toLocaleString()}</p>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="px-4 py-2.5 border-b border-line">
          <h2 className="text-sm font-semibold text-ink">Per Account</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
            <tr>
              <th className="text-left px-3 py-2">Account</th>
              <th className="text-right px-3 py-2">Opening</th>
              <th className="text-right px-3 py-2">Receipts</th>
              <th className="text-right px-3 py-2">Payments</th>
              <th className="text-right px-3 py-2">Closing</th>
            </tr>
          </thead>
          <tbody>
            {CASH_CODES.map((code) => (
              <tr key={code} className="border-t border-line">
                <td className="px-3 py-2 text-ink">{ACCOUNT_LABEL[code]}</td>
                <td className="px-3 py-2 text-right tabular text-ink-soft">{openingByCode[code].toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular text-good">+{receiptsByCode[code].toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular text-bad">-{paymentsByCode[code].toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular text-ink font-medium">
                  {(openingByCode[code] + receiptsByCode[code] - paymentsByCode[code]).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="px-4 py-2.5 border-b border-line">
          <h2 className="text-sm font-semibold text-ink">Transactions</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-left px-3 py-2">Narration</th>
                <th className="text-left px-3 py-2">Account</th>
                <th className="text-right px-3 py-2">Debit</th>
                <th className="text-right px-3 py-2">Credit</th>
                <th className="text-right px-3 py-2">Running Balance</th>
              </tr>
            </thead>
            <tbody>
              {transactionsWithBalance.map((t, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="px-3 py-2 text-ink-faint text-xs">{t.date}</td>
                  <td className="px-3 py-2 text-ink-soft">{t.narration}</td>
                  <td className="px-3 py-2 text-ink-soft text-xs">{t.account}</td>
                  <td className="px-3 py-2 text-right tabular text-ink">{t.debit > 0 ? t.debit.toLocaleString() : ""}</td>
                  <td className="px-3 py-2 text-right tabular text-ink">{t.credit > 0 ? t.credit.toLocaleString() : ""}</td>
                  <td className="px-3 py-2 text-right tabular text-ink-soft">{t.running.toLocaleString()}</td>
                </tr>
              ))}
              {!transactions.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-ink-faint">
                    No Cash/Bank/Petty Cash transactions in this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
