import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { NewContraEntryForm } from "@/components/NewContraEntryForm";

export default async function NewTransferPage() {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "accounts"))) redirect("/transfers");

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
