import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { NewJournalVoucherForm } from "@/components/NewJournalVoucherForm";

export default async function NewJournalVoucherPage() {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "journal_voucher.manage"))) redirect("/journal-vouchers");

  const supabase = await createClient();
  const [{ data: accounts }, { data: parties }, { data: bankAccounts }, { data: pettyCashFunds }] = await Promise.all([
    supabase.from("chart_of_accounts").select("*").eq("is_active", true).order("code"),
    // Only a first page of parties, and only the columns the picker shows —
    // the rest are found by typing, searched in the database. No is_active
    // filter here, deliberately: a manual Journal Voucher may legitimately
    // need to name a party that has since been deactivated, exactly as
    // before.
    supabase.from("parties").select("id, legal_name").order("legal_name").limit(20),
    supabase.from("bank_accounts").select("*").eq("is_active", true).order("account_name"),
    supabase.from("petty_cash_funds").select("*").eq("is_active", true).order("fund_name"),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <Link href="/journal-vouchers" className="text-xs text-ink-faint hover:text-ink">
          ← Journal Vouchers
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">New Journal Voucher</h1>
        <p className="text-sm text-ink-soft">Manual entry — use this only when no other transaction screen (Payment, Expense, Transfer) applies.</p>
      </div>

      <NewJournalVoucherForm accounts={accounts ?? []} parties={parties ?? []} bankAccounts={bankAccounts ?? []} pettyCashFunds={pettyCashFunds ?? []} />
    </div>
  );
}
