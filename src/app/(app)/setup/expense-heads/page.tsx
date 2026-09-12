import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner } from "@/lib/auth";
import { NewExpenseHeadForm } from "@/components/NewExpenseHeadForm";
import { ToggleExpenseHeadButton } from "@/components/ToggleExpenseHeadButton";

export default async function ExpenseHeadsPage() {
  const user = await getCurrentUser();
  if (!isOwner(user)) redirect("/");

  const supabase = await createClient();
  const { data: heads } = await supabase.from("expense_heads").select("*").order("name");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Expense Heads</h1>
        <p className="mt-1 text-sm text-ink-soft">A separate P&amp;L account is created automatically for each head — Expenses are booked under these categories.</p>
      </div>

      <NewExpenseHeadForm />

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
            <tr>
              <th className="text-left px-4 py-2.5">Code</th>
              <th className="text-left px-4 py-2.5">Name</th>
              <th className="text-left px-4 py-2.5">Account</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {(heads ?? []).map((h) => (
              <tr key={h.id} className="border-t border-line">
                <td className="px-4 py-2.5 font-mono text-xs text-ink-soft">{h.code}</td>
                <td className="px-4 py-2.5 text-ink">{h.name}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-ink-faint">{h.account_code}</td>
                <td className="px-4 py-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${h.is_active ? "bg-good-soft text-good" : "bg-surface-2 text-ink-faint"}`}>
                    {h.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <ToggleExpenseHeadButton id={h.id} isActive={h.is_active} />
                </td>
              </tr>
            ))}
            {!heads?.length && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-faint">
                  No expense head has been created yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
