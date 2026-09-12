import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";

export default async function BalanceSheetPage() {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "accounts") || hasRole(user, "auditor"))) redirect("/");

  const supabase = await createClient();
  const { data: rows } = await supabase.from("trial_balance").select("*").order("code");

  const assetRows = (rows ?? []).filter((r) => r.account_type === "asset").map((r) => ({ code: r.code, name: r.name, amount: r.balance ?? 0 }));
  const liabilityRows = (rows ?? []).filter((r) => r.account_type === "liability").map((r) => ({ code: r.code, name: r.name, amount: -(r.balance ?? 0) }));
  const equityRows = (rows ?? []).filter((r) => r.account_type === "equity").map((r) => ({ code: r.code, name: r.name, amount: -(r.balance ?? 0) }));
  const incomeTotal = (rows ?? []).filter((r) => r.account_type === "income").reduce((s, r) => s - (r.balance ?? 0), 0);
  const expenseTotal = (rows ?? []).filter((r) => r.account_type === "expense").reduce((s, r) => s + (r.balance ?? 0), 0);
  const retainedEarnings = incomeTotal - expenseTotal;

  const totalAssets = assetRows.reduce((s, r) => s + r.amount, 0);
  const totalLiabilities = liabilityRows.reduce((s, r) => s + r.amount, 0);
  const totalEquityAccounts = equityRows.reduce((s, r) => s + r.amount, 0);
  const totalEquity = totalEquityAccounts + retainedEarnings;
  const difference = totalAssets - (totalLiabilities + totalEquity);
  const balanced = Math.round(difference * 100) === 0;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/reports" className="text-xs text-ink-faint hover:text-ink">
          ← Reports
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">Balance Sheet</h1>
        <p className="text-sm text-ink-soft">As of today — a live snapshot of the entire ledger (a historical &quot;as of date&quot; is not yet supported).</p>
      </div>

      {!balanced && (
        <div className="rounded-md border border-bad bg-bad-soft px-4 py-2.5 text-sm text-bad">
          Balance Sheet is not balancing — difference: {difference.toLocaleString()}. Check the Trial Balance.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="px-4 py-2.5 border-b border-line bg-surface-2">
            <h2 className="text-sm font-semibold text-ink">Assets</h2>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {assetRows.map((r) => (
                <tr key={r.code} className="border-t border-line">
                  <td className="px-4 py-1.5 text-ink-soft">{r.name}</td>
                  <td className="px-4 py-1.5 text-right tabular text-ink">{r.amount.toLocaleString()}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-line-strong font-semibold bg-accent-soft/30">
                <td className="px-4 py-2 text-ink">Total Assets</td>
                <td className="px-4 py-2 text-right tabular text-ink">{totalAssets.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-line bg-surface overflow-hidden">
            <div className="px-4 py-2.5 border-b border-line bg-surface-2">
              <h2 className="text-sm font-semibold text-ink">Liabilities</h2>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {liabilityRows.map((r) => (
                  <tr key={r.code} className="border-t border-line">
                    <td className="px-4 py-1.5 text-ink-soft">{r.name}</td>
                    <td className="px-4 py-1.5 text-right tabular text-ink">{r.amount.toLocaleString()}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-line-strong font-semibold">
                  <td className="px-4 py-2 text-ink">Total Liabilities</td>
                  <td className="px-4 py-2 text-right tabular text-ink">{totalLiabilities.toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border border-line bg-surface overflow-hidden">
            <div className="px-4 py-2.5 border-b border-line bg-surface-2">
              <h2 className="text-sm font-semibold text-ink">Equity</h2>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {equityRows.map((r) => (
                  <tr key={r.code} className="border-t border-line">
                    <td className="px-4 py-1.5 text-ink-soft">{r.name}</td>
                    <td className="px-4 py-1.5 text-right tabular text-ink">{r.amount.toLocaleString()}</td>
                  </tr>
                ))}
                <tr className="border-t border-line">
                  <td className="px-4 py-1.5 text-ink-soft">Retained Earnings (accumulated Net Profit — books never period-closed)</td>
                  <td className="px-4 py-1.5 text-right tabular text-ink">{retainedEarnings.toLocaleString()}</td>
                </tr>
                <tr className="border-t-2 border-line-strong font-semibold">
                  <td className="px-4 py-2 text-ink">Total Equity</td>
                  <td className="px-4 py-2 text-right tabular text-ink">{totalEquity.toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border border-accent bg-accent-soft/30 p-4 flex items-center justify-between">
            <span className="text-sm font-semibold text-ink">Liabilities + Equity</span>
            <span className="text-sm font-semibold tabular text-ink">{(totalLiabilities + totalEquity).toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
