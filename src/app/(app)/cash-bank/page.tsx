import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";

export default async function CashBankPage() {
  const user = await getCurrentUser();
  const canView = isOwner(user) || hasRole(user, "accounts") || hasRole(user, "auditor");
  if (!canView) redirect("/");

  const supabase = await createClient();
  const [{ data: cashRow }, { data: bankBalances }, { data: pettyBalances }] = await Promise.all([
    supabase.from("cash_in_hand_balance").select("*").maybeSingle(),
    supabase.from("bank_account_balances").select("*").eq("is_active", true).order("account_name"),
    supabase.from("petty_cash_fund_balances").select("*").eq("is_active", true).order("fund_name"),
  ]);

  const cashBalance = cashRow?.balance ?? 0;
  const bankTotal = (bankBalances ?? []).reduce((s, b) => s + (b.balance ?? 0), 0);
  const pettyTotal = (pettyBalances ?? []).reduce((s, p) => s + (p.balance ?? 0), 0);
  const grandTotal = cashBalance + bankTotal + pettyTotal;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Cash &amp; Bank Position</h1>
          <p className="mt-1 text-sm text-ink-soft">Live balances — every transaction (Payment, Expense, Transfer, Journal Voucher) is reflected here.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/transfers/new" className="rounded-md border border-line-strong bg-bg px-3 py-2 text-xs text-ink hover:bg-surface-2 transition">
            Fund Transfer
          </Link>
          <Link href="/expenses/new" className="rounded-md border border-line-strong bg-bg px-3 py-2 text-xs text-ink hover:bg-surface-2 transition">
            Expense
          </Link>
          <Link href="/journal-vouchers/new" className="rounded-md border border-line-strong bg-bg px-3 py-2 text-xs text-ink hover:bg-surface-2 transition">
            Journal Voucher
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Cash in Hand</p>
          <p className="mt-1 text-xl font-semibold text-ink tabular">{cashBalance.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Bank Accounts</p>
          <p className="mt-1 text-xl font-semibold text-ink tabular">{bankTotal.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Petty Cash</p>
          <p className="mt-1 text-xl font-semibold text-ink tabular">{pettyTotal.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-accent bg-accent-soft/30 p-4">
          <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Total Cash Position</p>
          <p className="mt-1 text-xl font-semibold text-ink tabular">{grandTotal.toLocaleString()}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="px-4 py-2.5 border-b border-line flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Bank Accounts</h2>
            <Link href="/setup/bank-accounts" className="text-xs text-accent-ink underline underline-offset-2">
              Manage
            </Link>
          </div>
          <ul className="divide-y divide-line">
            {(bankBalances ?? []).map((b) => (
              <li key={b.bank_account_id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <div>
                  <span className="text-ink">{b.account_name}</span>
                  {b.bank_name && <span className="text-ink-faint text-xs ml-2">({b.bank_name})</span>}
                </div>
                <span className="tabular text-ink font-medium">{(b.balance ?? 0).toLocaleString()}</span>
              </li>
            ))}
            {!bankBalances?.length && <li className="px-4 py-6 text-center text-ink-faint text-sm">No active bank account.</li>}
          </ul>
        </div>

        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="px-4 py-2.5 border-b border-line flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Petty Cash Funds</h2>
            <Link href="/setup/petty-cash-funds" className="text-xs text-accent-ink underline underline-offset-2">
              Manage
            </Link>
          </div>
          <ul className="divide-y divide-line">
            {(pettyBalances ?? []).map((p) => (
              <li key={p.petty_cash_fund_id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="text-ink">{p.fund_name}</span>
                <span className="tabular text-ink font-medium">{(p.balance ?? 0).toLocaleString()}</span>
              </li>
            ))}
            {!pettyBalances?.length && <li className="px-4 py-6 text-center text-ink-faint text-sm">No active petty cash fund.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
