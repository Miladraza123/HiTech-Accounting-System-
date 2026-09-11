import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { NewJournalVoucherForm } from "@/components/NewJournalVoucherForm";

export default async function NewJournalVoucherPage() {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "accounts"))) redirect("/journal-vouchers");

  const supabase = await createClient();
  const [{ data: accounts }, { data: parties }, { data: bankAccounts }, { data: pettyCashFunds }] = await Promise.all([
    supabase.from("chart_of_accounts").select("*").eq("is_active", true).order("code"),
    supabase.from("parties").select("*").order("legal_name"),
    supabase.from("bank_accounts").select("*").eq("is_active", true).order("account_name"),
    supabase.from("petty_cash_funds").select("*").eq("is_active", true).order("fund_name"),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <Link href="/journal-vouchers" className="text-xs text-ink-faint hover:text-ink">
          ← Journal Vouchers
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">Naya Journal Voucher</h1>
        <p className="text-sm text-ink-soft">Manual entry — sirf tab use karen jab koi doosra transaction screen (Payment, Expense, Transfer) applicable na ho.</p>
      </div>

      <NewJournalVoucherForm accounts={accounts ?? []} parties={parties ?? []} bankAccounts={bankAccounts ?? []} pettyCashFunds={pettyCashFunds ?? []} />
    </div>
  );
}
