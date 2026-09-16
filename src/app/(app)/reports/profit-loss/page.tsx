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
  // The period's per-account net is summed by the database (fn_profit_loss)
  // rather than by fetching every journal entry and line in the period and
  // reducing them here. journal_entries grows with every posted document, so
  // the old shape shipped an entire financial year of transactions to the app
  // on each page view; this returns one row per account instead.
  const { data: accounts } = await supabase.rpc("fn_profit_loss", { p_from: fromDate, p_to: toDate });

  const byCode = (accounts ?? []).slice().sort((a, b) => a.code.localeCompare(b.code));

  const revenueRows = byCode
    .filter((a) => a.account_type === "income")
    .map((a) => ({ code: a.code, name: a.name, amount: -a.net }));
  const cogsRows = byCode
    .filter((a) => a.code === "5000" || a.code === "5010")
    .map((a) => ({ code: a.code, name: a.name, amount: a.net }));
  const opexRows = byCode
    .filter((a) => a.account_type === "expense" && a.code !== "5000" && a.code !== "5010")
    .map((a) => ({ code: a.code, name: a.name, amount: a.net }));

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
