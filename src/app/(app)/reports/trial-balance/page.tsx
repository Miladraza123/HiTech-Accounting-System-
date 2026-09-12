import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";

// Normal balance side per account type — used only to label Dr/Cr, the
// numbers themselves are never flipped.
const DEBIT_NORMAL = new Set(["asset", "expense"]);

export default async function TrialBalancePage() {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "accounts") || hasRole(user, "auditor"))) redirect("/");

  const supabase = await createClient();
  const { data: rows } = await supabase.from("trial_balance").select("*").order("code");

  const active = (rows ?? []).filter((r) => (r.total_debit ?? 0) !== 0 || (r.total_credit ?? 0) !== 0);
  const totalDebit = active.reduce((s, r) => s + (r.total_debit ?? 0), 0);
  const totalCredit = active.reduce((s, r) => s + (r.total_credit ?? 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href="/reports" className="text-xs text-ink-faint hover:text-ink">
            ← Reports
          </Link>
          <h1 className="text-lg font-semibold text-ink mt-1">Trial Balance</h1>
        </div>
        <a href="/reports/trial-balance/export" className="rounded-md border border-line-strong bg-bg px-3 py-2 text-xs text-ink hover:bg-surface-2 transition whitespace-nowrap">
          Export to Excel
        </a>
      </div>

      {!balanced && (
        <div className="rounded-md bg-bad-soft border border-bad px-4 py-2 text-sm text-bad">
          ⚠ Trial Balance is not balanced (Debit {totalDebit.toLocaleString()} ≠ Credit {totalCredit.toLocaleString()}) — this can only happen
          if there is a database-level issue, since every journal entry is constrained to be balanced at the time it is posted.
        </div>
      )}

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-3 py-2">Code</th>
                <th className="text-left px-3 py-2">Account</th>
                <th className="text-left px-3 py-2">Type</th>
                <th className="text-right px-3 py-2">Debit</th>
                <th className="text-right px-3 py-2">Credit</th>
                <th className="text-right px-3 py-2">Balance</th>
              </tr>
            </thead>
            <tbody>
              {active.map((r) => {
                const isDebitNormal = DEBIT_NORMAL.has(r.account_type ?? "");
                const balance = r.balance ?? 0;
                const shown = isDebitNormal ? balance : -balance;
                return (
                  <tr key={r.account_id} className="border-t border-line">
                    <td className="px-3 py-2 font-mono text-xs text-ink">{r.code}</td>
                    <td className="px-3 py-2 text-ink">{r.name}</td>
                    <td className="px-3 py-2 text-ink-soft text-xs capitalize">{r.account_type}</td>
                    <td className="px-3 py-2 text-right tabular text-ink-soft">{(r.total_debit ?? 0).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular text-ink-soft">{(r.total_credit ?? 0).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular text-ink font-medium">
                      {Math.abs(shown).toLocaleString()} {shown >= 0 ? "Dr" : "Cr"}
                    </td>
                  </tr>
                );
              })}
              {!active.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-ink-faint">
                    No posted journal entries yet.
                  </td>
                </tr>
              )}
            </tbody>
            {!!active.length && (
              <tfoot>
                <tr className="border-t-2 border-line-strong bg-surface-2 font-semibold text-ink">
                  <td colSpan={3} className="px-3 py-2 text-xs uppercase tracking-wide">
                    Total
                  </td>
                  <td className="px-3 py-2 text-right tabular">{totalDebit.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular">{totalCredit.toLocaleString()}</td>
                  <td className="px-3 py-2" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
