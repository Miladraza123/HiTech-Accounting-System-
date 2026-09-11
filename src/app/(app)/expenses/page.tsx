import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";

const STATUS_STYLE: Record<string, string> = {
  Posted: "bg-good-soft text-good",
  Cancelled: "bg-bad-soft text-bad",
};

const SOURCE_LABEL: Record<string, string> = { cash: "Cash", bank: "Bank", petty_cash: "Petty Cash" };

export default async function ExpensesPage() {
  const user = await getCurrentUser();
  const canCreate = isOwner(user) || hasRole(user, "accounts");

  const supabase = await createClient();
  const { data: expenses } = await supabase
    .from("expenses")
    .select("*, expense_heads(name), bank_accounts(account_name), petty_cash_funds(fund_name)")
    .order("expense_date", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink">Expenses</h1>
          <p className="mt-1 text-sm text-ink-soft">Fuel, transport, office, site waghera — Cash/Bank/Petty Cash se book honay wale kharche.</p>
        </div>
        {canCreate && (
          <Link href="/expenses/new" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition">
            + Nayi Expense
          </Link>
        )}
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-4 py-2.5">Expense #</th>
                <th className="text-left px-4 py-2.5">Head</th>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-4 py-2.5">Paid From</th>
                <th className="text-right px-4 py-2.5">Amount</th>
                <th className="text-left px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {(expenses ?? []).map((e) => {
                const head = e.expense_heads as unknown as { name: string } | null;
                const bank = e.bank_accounts as unknown as { account_name: string } | null;
                const fund = e.petty_cash_funds as unknown as { fund_name: string } | null;
                const sourceLabel = bank?.account_name ?? fund?.fund_name ?? SOURCE_LABEL[e.payment_source];
                return (
                  <tr key={e.id} className="border-t border-line hover:bg-surface-2">
                    <td className="px-4 py-2.5">
                      <Link href={`/expenses/${e.id}`} className="text-accent-ink underline underline-offset-2 font-mono text-xs">
                        {e.expense_no}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-ink">{head?.name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-ink-faint text-xs">{e.expense_date}</td>
                    <td className="px-4 py-2.5 text-ink-soft text-xs">{sourceLabel}</td>
                    <td className="px-4 py-2.5 text-right tabular text-ink">{e.amount.toLocaleString()}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[e.status] ?? ""}`}>{e.status}</span>
                    </td>
                  </tr>
                );
              })}
              {!expenses?.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-ink-faint">
                    Koi expense record nahi hai abhi tak.
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
