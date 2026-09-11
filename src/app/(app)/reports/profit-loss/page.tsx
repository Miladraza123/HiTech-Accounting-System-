import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";

function defaultFyRange(): { from: string; to: string } {
  const now = new Date();
  const fyStartYear = now.getMonth() + 1 >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return { from: `${fyStartYear}-07-01`, to: `${fyStartYear + 1}-06-30` };
}

export default async function ProfitLossPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "accounts") || hasRole(user, "auditor"))) redirect("/");

  const { from, to } = await searchParams;
  const defaults = defaultFyRange();
  const fromDate = from || defaults.from;
  const toDate = to || defaults.to;

  const supabase = await createClient();
  const { data: entries } = await supabase
    .from("journal_entries")
    .select("entry_date, journal_lines(debit, credit, chart_of_accounts(code, name, account_type))")
    .gte("entry_date", fromDate)
    .lte("entry_date", toDate);

  type Line = { debit: number; credit: number; chart_of_accounts: { code: string; name: string; account_type: string } | null };
  const accountTotals = new Map<string, { name: string; account_type: string; net: number }>();

  for (const e of entries ?? []) {
    const lines = e.journal_lines as unknown as Line[];
    for (const l of lines) {
      const acc = l.chart_of_accounts;
      if (!acc) continue;
      const existing = accountTotals.get(acc.code) ?? { name: acc.name, account_type: acc.account_type, net: 0 };
      existing.net += l.debit - l.credit;
      accountTotals.set(acc.code, existing);
    }
  }

  const revenueRows = [...accountTotals.entries()].filter(([, v]) => v.account_type === "income").map(([code, v]) => ({ code, name: v.name, amount: -v.net }));
  const cogsRows = [...accountTotals.entries()].filter(([code]) => code === "5000" || code === "5010").map(([code, v]) => ({ code, name: v.name, amount: v.net }));
  const opexRows = [...accountTotals.entries()]
    .filter(([code, v]) => v.account_type === "expense" && code !== "5000" && code !== "5010")
    .map(([code, v]) => ({ code, name: v.name, amount: v.net }))
    .sort((a, b) => a.code.localeCompare(b.code));

  const totalRevenue = revenueRows.reduce((s, r) => s + r.amount, 0);
  const totalCogs = cogsRows.reduce((s, r) => s + r.amount, 0);
  const grossProfit = totalRevenue - totalCogs;
  const totalOpex = opexRows.reduce((s, r) => s + r.amount, 0);
  const netProfit = grossProfit - totalOpex;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/reports" className="text-xs text-ink-faint hover:text-ink">
          ← Reports
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">Profit &amp; Loss Statement</h1>
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
        <Link href="/reports/profit-loss" className="text-xs text-ink-faint underline underline-offset-2">
          Current FY
        </Link>
      </form>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <table className="w-full text-sm">
          <tbody>
            <tr className="bg-surface-2">
              <td className="px-4 py-2 font-semibold text-ink text-xs uppercase tracking-wide" colSpan={2}>
                Revenue
              </td>
            </tr>
            {revenueRows.map((r) => (
              <tr key={r.code} className="border-t border-line">
                <td className="px-4 py-1.5 text-ink-soft pl-8">{r.name}</td>
                <td className="px-4 py-1.5 text-right tabular text-ink">{r.amount.toLocaleString()}</td>
              </tr>
            ))}
            <tr className="border-t border-line font-medium">
              <td className="px-4 py-2 text-ink">Total Revenue</td>
              <td className="px-4 py-2 text-right tabular text-ink">{totalRevenue.toLocaleString()}</td>
            </tr>

            <tr className="bg-surface-2">
              <td className="px-4 py-2 font-semibold text-ink text-xs uppercase tracking-wide" colSpan={2}>
                Cost of Goods Sold
              </td>
            </tr>
            {cogsRows.map((r) => (
              <tr key={r.code} className="border-t border-line">
                <td className="px-4 py-1.5 text-ink-soft pl-8">{r.name}</td>
                <td className="px-4 py-1.5 text-right tabular text-ink">{r.amount.toLocaleString()}</td>
              </tr>
            ))}
            <tr className="border-t border-line font-medium">
              <td className="px-4 py-2 text-ink">Total COGS</td>
              <td className="px-4 py-2 text-right tabular text-ink">{totalCogs.toLocaleString()}</td>
            </tr>

            <tr className="border-t-2 border-line-strong font-semibold bg-accent-soft/30">
              <td className="px-4 py-2 text-ink">Gross Profit</td>
              <td className="px-4 py-2 text-right tabular text-ink">{grossProfit.toLocaleString()}</td>
            </tr>

            <tr className="bg-surface-2">
              <td className="px-4 py-2 font-semibold text-ink text-xs uppercase tracking-wide" colSpan={2}>
                Operating Expenses
              </td>
            </tr>
            {opexRows.map((r) => (
              <tr key={r.code} className="border-t border-line">
                <td className="px-4 py-1.5 text-ink-soft pl-8">{r.name}</td>
                <td className="px-4 py-1.5 text-right tabular text-ink">{r.amount.toLocaleString()}</td>
              </tr>
            ))}
            <tr className="border-t border-line font-medium">
              <td className="px-4 py-2 text-ink">Total Operating Expenses</td>
              <td className="px-4 py-2 text-right tabular text-ink">{totalOpex.toLocaleString()}</td>
            </tr>

            <tr className={`border-t-2 border-line-strong font-semibold ${netProfit >= 0 ? "bg-good-soft" : "bg-bad-soft"}`}>
              <td className={`px-4 py-2.5 ${netProfit >= 0 ? "text-good" : "text-bad"}`}>Net Profit / (Loss)</td>
              <td className={`px-4 py-2.5 text-right tabular ${netProfit >= 0 ? "text-good" : "text-bad"}`}>{netProfit.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
