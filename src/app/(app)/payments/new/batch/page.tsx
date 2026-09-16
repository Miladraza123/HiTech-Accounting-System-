import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { MultiPaymentForm } from "@/components/MultiPaymentForm";

export default async function BatchPaymentPage() {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "payment.manage"))) redirect("/payments");

  const supabase = await createClient();
  // Only a first page of each party list, and only the columns the picker
  // renders — the rest are found by typing, searched in the database. Two
  // lists because each row's eligible set depends on its own direction.
  const [{ data: clientParties }, { data: supplierParties }, { data: bankAccounts }, { data: pettyCashFunds }] = await Promise.all([
    supabase.from("parties").select("id, legal_name").eq("is_active", true).in("party_type", ["client", "both"]).order("legal_name").limit(20),
    supabase.from("parties").select("id, legal_name").eq("is_active", true).in("party_type", ["supplier", "both"]).order("legal_name").limit(20),
    supabase.from("bank_accounts").select("*").eq("is_active", true).order("account_name"),
    supabase.from("petty_cash_funds").select("*").eq("is_active", true).order("fund_name"),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <Link href="/payments" className="text-xs text-ink-faint hover:text-ink">
          ← Payments
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">Multiple Payments</h1>
        <p className="mt-1 text-sm text-ink-soft">Record several receipts or payments at once — each becomes its own payment document.</p>
      </div>

      <MultiPaymentForm
        clientParties={clientParties ?? []}
        supplierParties={supplierParties ?? []}
        bankAccounts={bankAccounts ?? []}
        pettyCashFunds={pettyCashFunds ?? []}
      />
    </div>
  );
}
