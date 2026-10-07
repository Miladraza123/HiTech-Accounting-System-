import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, hasRole, isOwner } from "@/lib/auth";
import { canReadHr } from "@/lib/hrAccess";
import { money } from "@/lib/hrSalary";
import { cancelAdvanceAction } from "@/app/actions/hr";
import { NewAdvanceForm } from "@/components/NewAdvanceForm";
import { CancelWithReasonButton } from "@/components/CancelWithReasonButton";

export default async function AdvancesPage() {
  const user = await getCurrentUser();
  if (!canReadHr(user)) redirect("/");
  const canPay = isOwner(user) || hasRole(user, "accounts");

  const supabase = await createClient();
  const [{ data: advances }, { data: balances }, { data: employees }, { data: banks }, { data: funds }, { data: settings }] = await Promise.all([
    supabase.from("hr_advances").select("*, hr_employees(code, full_name)").order("advance_date", { ascending: false }).limit(300),
    supabase.from("hr_advance_balances").select("id, recovered, outstanding"),
    supabase.from("hr_employees").select("id, code, full_name").eq("status", "Active").order("full_name"),
    supabase.from("bank_accounts").select("id, account_name").eq("is_active", true).order("account_name"),
    supabase.from("petty_cash_funds").select("id, fund_name").eq("is_active", true).order("fund_name"),
    supabase.from("hr_settings").select("salary_journal_enabled").maybeSingle(),
  ]);
  const bal = new Map((balances ?? []).map((b) => [b.id, b]));
  const totalOutstanding = (balances ?? []).reduce((t, b) => t + Number(b.outstanding ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Advances & Loans</h1>
        <p className="mt-1 text-sm text-ink-soft">Outstanding with staff: {money(totalOutstanding)}</p>
      </div>
      {canPay && (
        <NewAdvanceForm employees={employees ?? []} bankAccounts={banks ?? []} pettyCashFunds={funds ?? []} journalOn={!!settings?.salary_journal_enabled} />
      )}
      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-4 py-2.5">Advance</th>
                <th className="text-left px-4 py-2.5">Employee</th>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-right px-4 py-2.5">Amount</th>
                <th className="text-right px-4 py-2.5">Per salary</th>
                <th className="text-right px-4 py-2.5">Recovered</th>
                <th className="text-right px-4 py-2.5">Outstanding</th>
                <th className="text-left px-4 py-2.5">Status</th>
                {canPay && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {(advances ?? []).map((a) => {
                const e = a.hr_employees as unknown as { code: string; full_name: string };
                const b = bal.get(a.id);
                return (
                  <tr key={a.id} className="border-t border-line align-top">
                    <td className="px-4 py-2.5 font-mono text-xs">
                      {a.advance_no}
                      {a.note && <span className="block font-sans text-[11px] text-ink-faint">{a.note}</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {e.full_name} <span className="font-mono text-xs text-ink-faint">{e.code}</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">{a.advance_date}</td>
                    <td className="px-4 py-2.5 text-right tabular">{money(a.amount)}</td>
                    <td className="px-4 py-2.5 text-right tabular">{money(a.installment)}</td>
                    <td className="px-4 py-2.5 text-right tabular">{money(b?.recovered)}</td>
                    <td className="px-4 py-2.5 text-right tabular font-medium">{money(b?.outstanding)}</td>
                    <td className="px-4 py-2.5 text-xs">
                      {a.status}
                      {a.cancel_reason && <span className="block text-[11px] text-ink-faint">{a.cancel_reason}</span>}
                    </td>
                    {canPay && (
                      <td className="px-4 py-2.5 text-right">
                        {a.status === "Active" && Number(b?.recovered ?? 0) === 0 && (
                          <CancelWithReasonButton label="Cancel" onCancel={cancelAdvanceAction.bind(null, a.id)} />
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {!advances?.length && (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-ink-faint">
                    No advances.
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
