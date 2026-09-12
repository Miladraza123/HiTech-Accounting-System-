import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { AddAccountForm } from "@/components/AddAccountForm";

const TYPE_STYLE: Record<string, string> = {
  asset: "bg-ledger-soft text-ledger",
  liability: "bg-warn-soft text-warn",
  equity: "bg-surface-2 text-ink-soft",
  income: "bg-good-soft text-good",
  expense: "bg-bad-soft text-bad",
};

export default async function ChartOfAccountsPage() {
  const user = await getCurrentUser();
  const canView = isOwner(user) || hasRole(user, "accounts");
  if (!canView) redirect("/");

  const supabase = await createClient();
  const { data: accounts } = await supabase.from("chart_of_accounts").select("*").order("code");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Chart of Accounts</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Every transaction (Purchase, Invoice, Payment) automatically posts a double-entry into these
          accounts — no manual journal entry is needed.
        </p>
      </div>

      {isOwner(user) && <AddAccountForm accounts={accounts ?? []} />}

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
            <tr>
              <th className="text-left px-4 py-2.5">Code</th>
              <th className="text-left px-4 py-2.5">Name</th>
              <th className="text-left px-4 py-2.5">Type</th>
            </tr>
          </thead>
          <tbody>
            {(accounts ?? []).map((a) => (
              <tr key={a.id} className="border-t border-line">
                <td className="px-4 py-2.5 font-mono text-ink-soft tabular">{a.code}</td>
                <td className="px-4 py-2.5 text-ink">{a.name}</td>
                <td className="px-4 py-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${TYPE_STYLE[a.account_type] ?? ""}`}>
                    {a.account_type}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
