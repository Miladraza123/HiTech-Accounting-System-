import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { NewPettyCashFundForm } from "@/components/NewPettyCashFundForm";
import { TogglePettyCashFundButton } from "@/components/TogglePettyCashFundButton";

export default async function PettyCashFundsPage() {
  const user = await getCurrentUser();
  const canManage = isOwner(user) || hasRole(user, "accounts");
  if (!canManage) redirect("/");

  const supabase = await createClient();
  const [{ data: funds }, { data: balances }, { data: profiles }] = await Promise.all([
    supabase.from("petty_cash_funds").select("*, profiles(full_name)").order("created_at"),
    supabase.from("petty_cash_fund_balances").select("*"),
    supabase.from("profiles").select("*").eq("is_active", true).order("full_name"),
  ]);
  const balanceMap = new Map((balances ?? []).map((b) => [b.petty_cash_fund_id, b.balance]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Petty Cash Funds</h1>
        <p className="mt-1 text-sm text-ink-soft">Har site/department/person ka alag petty cash fund — Expenses in mein se select honge.</p>
      </div>

      <NewPettyCashFundForm profiles={profiles ?? []} />

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
            <tr>
              <th className="text-left px-4 py-2.5">Fund Name</th>
              <th className="text-left px-4 py-2.5">Custodian</th>
              <th className="text-right px-4 py-2.5">Balance</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {(funds ?? []).map((f) => {
              const custodian = f.profiles as unknown as { full_name: string } | null;
              return (
                <tr key={f.id} className="border-t border-line">
                  <td className="px-4 py-2.5 text-ink">{f.fund_name}</td>
                  <td className="px-4 py-2.5 text-ink-soft">{custodian?.full_name ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular text-ink">{(balanceMap.get(f.id) ?? 0).toLocaleString()}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${f.is_active ? "bg-good-soft text-good" : "bg-surface-2 text-ink-faint"}`}>
                      {f.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <TogglePettyCashFundButton id={f.id} isActive={f.is_active} />
                  </td>
                </tr>
              );
            })}
            {!funds?.length && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-faint">
                  Koi petty cash fund nahi bana abhi tak.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
