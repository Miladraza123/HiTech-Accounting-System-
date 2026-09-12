import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { NewBankAccountForm } from "@/components/NewBankAccountForm";
import { ToggleBankAccountButton } from "@/components/ToggleBankAccountButton";

export default async function BankAccountsPage() {
  const user = await getCurrentUser();
  const canManage = isOwner(user) || hasRole(user, "accounts");
  if (!canManage) redirect("/");

  const supabase = await createClient();
  const [{ data: accounts }, { data: balances }] = await Promise.all([
    supabase.from("bank_accounts").select("*").order("created_at"),
    supabase.from("bank_account_balances").select("*"),
  ]);
  const balanceMap = new Map((balances ?? []).map((b) => [b.bank_account_id, b.balance]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Bank Accounts</h1>
        <p className="mt-1 text-sm text-ink-soft">The company&apos;s bank accounts — Payments and Expenses will be selected from among these.</p>
      </div>

      <NewBankAccountForm />

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
            <tr>
              <th className="text-left px-4 py-2.5">Account Name</th>
              <th className="text-left px-4 py-2.5">Bank</th>
              <th className="text-left px-4 py-2.5">Account #</th>
              <th className="text-right px-4 py-2.5">Balance</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {(accounts ?? []).map((a) => (
              <tr key={a.id} className="border-t border-line">
                <td className="px-4 py-2.5 text-ink">{a.account_name}</td>
                <td className="px-4 py-2.5 text-ink-soft">{a.bank_name ?? "—"}</td>
                <td className="px-4 py-2.5 text-ink-soft font-mono text-xs">{a.account_number ?? "—"}</td>
                <td className="px-4 py-2.5 text-right tabular text-ink">{(balanceMap.get(a.id) ?? 0).toLocaleString()}</td>
                <td className="px-4 py-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${a.is_active ? "bg-good-soft text-good" : "bg-surface-2 text-ink-faint"}`}>
                    {a.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <ToggleBankAccountButton id={a.id} isActive={a.is_active} />
                </td>
              </tr>
            ))}
            {!accounts?.length && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-ink-faint">
                  No bank accounts created yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
