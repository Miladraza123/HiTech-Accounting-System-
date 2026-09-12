import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { NewExpenseForm } from "@/components/NewExpenseForm";

export default async function NewExpensePage() {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "expense.manage"))) redirect("/expenses");

  const supabase = await createClient();
  const [{ data: expenseHeads }, { data: bankAccounts }, { data: pettyCashFunds }, { data: jobs }, { data: profiles }, { data: vehicles }] = await Promise.all([
    supabase.from("expense_heads").select("*").eq("is_active", true).order("name"),
    supabase.from("bank_accounts").select("*").eq("is_active", true).order("account_name"),
    supabase.from("petty_cash_funds").select("*").eq("is_active", true).order("fund_name"),
    supabase.from("jobs").select("id, job_no, description").not("status", "in", "(Delivered,Cancelled)").order("job_no"),
    supabase.from("profiles").select("*").eq("is_active", true).order("full_name"),
    supabase.from("vehicles").select("*").not("status", "eq", "Retired").order("vehicle_no"),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <Link href="/expenses" className="text-xs text-ink-faint hover:text-ink">
          ← Expenses
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">Nayi Expense</h1>
      </div>

      {!expenseHeads?.length ? (
        <div className="rounded-xl border border-warn bg-warn-soft p-5 text-sm text-warn max-w-xl">
          Pehle kam az kam ek Expense Head honi chahiye.{" "}
          <Link href="/setup/expense-heads" className="underline underline-offset-2 font-medium">
            Expense Head add karen
          </Link>
          .
        </div>
      ) : (
        <NewExpenseForm
          expenseHeads={expenseHeads}
          bankAccounts={bankAccounts ?? []}
          pettyCashFunds={pettyCashFunds ?? []}
          jobs={jobs ?? []}
          profiles={profiles ?? []}
          vehicles={vehicles ?? []}
        />
      )}
    </div>
  );
}
