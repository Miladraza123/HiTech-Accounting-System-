import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { NewContraEntryForm } from "@/components/NewContraEntryForm";

export default async function NewTransferPage() {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "fund_transfer.manage"))) redirect("/transfers");

  const supabase = await createClient();
  const [{ data: bankAccounts }, { data: pettyCashFunds }] = await Promise.all([
    supabase.from("bank_accounts").select("*").eq("is_active", true).order("account_name"),
    supabase.from("petty_cash_funds").select("*").eq("is_active", true).order("fund_name"),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <Link href="/transfers" className="text-xs text-ink-faint hover:text-ink">
          ← Fund Transfers
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">Naya Fund Transfer</h1>
      </div>

      <NewContraEntryForm bankAccounts={bankAccounts ?? []} pettyCashFunds={pettyCashFunds ?? []} />
    </div>
  );
}
