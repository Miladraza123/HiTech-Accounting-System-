import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { PrintPdfActions } from "@/components/PrintPdfActions";

export default async function TrialBalancePage() {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "accounts") || hasRole(user, "auditor"))) redirect("/");

  const supabase = await createClient();
  const [{ data: rows }, { data: company }] = await Promise.all([
    supabase.from("trial_balance").select("*").order("code"),
    supabase.from("company").select("signature_path, stamp_path, phone, email").maybeSingle(),
  ]);

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
        <div className="flex items-start gap-2">
          <a href="/reports/trial-balance/export" className="rounded-md border border-line-strong bg-bg px-3 py-2 text-xs text-ink hover:bg-surface-2 transition whitespace-nowrap">
            Export to Excel
          </a>
          <PrintPdfActions
            printPath="/reports/trial-balance/print"
            filename={`Trial-Balance-${new Date().toISOString().slice(0, 10)}.pdf`}
            hasSignature={!!company?.signature_path}
            hasStamp={!!company?.stamp_path}
            hasPhone={!!company?.phone}
            hasEmail={!!company?.email}
          />
        </div>
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
                // trial_balance.balance is debit - credit for every account
                // type, so its sign alone says which side the balance is on.
                const balance = r.balance ?? 0;
                return (
                  <tr key={r.account_id} className="border-t border-line">
                    <td className="px-3 py-2 font-mono text-xs text-ink">{r.code}</td>
                    <td className="px-3 py-2 text-ink">{r.name}</td>
                    <td className="px-3 py-2 text-ink-soft text-xs capitalize">{r.account_type}</td>
                    <td className="px-3 py-2 text-right tabular text-ink-soft">{(r.total_debit ?? 0).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular text-ink-soft">{(r.total_credit ?? 0).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular text-ink font-medium">
                      {Math.abs(balance).toLocaleString()} {balance >= 0 ? "Dr" : "Cr"}
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
