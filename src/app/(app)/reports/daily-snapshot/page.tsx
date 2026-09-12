import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { GenerateSnapshotButton } from "@/components/GenerateSnapshotButton";

export default async function DailySnapshotPage() {
  const user = await getCurrentUser();
  const canGenerate = isOwner(user) || hasRole(user, "accounts");
  if (!(canGenerate || hasRole(user, "auditor"))) redirect("/");

  const supabase = await createClient();
  const { data: snapshots } = await supabase.from("daily_snapshots").select("*").order("snapshot_date", { ascending: false }).limit(90);

  const latest = snapshots?.[0];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link href="/reports" className="text-xs text-ink-faint hover:text-ink">
            ← Reports
          </Link>
          <h1 className="text-lg font-semibold text-ink mt-1">Daily Snapshot</h1>
          <p className="text-sm text-ink-soft">
            A snapshot of the previous day is generated automatically at 00:10 every day. You can also generate or regenerate it manually below.
          </p>
        </div>
        {canGenerate && <GenerateSnapshotButton />}
      </div>

      {latest && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat label="Cash in Hand" value={latest.cash_in_hand} />
          <Stat label="Bank Balance" value={latest.bank_balance} />
          <Stat label="Petty Cash" value={latest.petty_cash_balance} />
          <Stat label="Stock Value" value={latest.stock_value} />
          <Stat label="Outstanding Receivable" value={latest.total_ar_outstanding} warn />
          <Stat label="Outstanding Payable" value={latest.total_ap_outstanding} warn />
          <Stat label={`Sales (${latest.snapshot_date})`} value={latest.sales_today} />
          <Stat label={`Expenses (${latest.snapshot_date})`} value={latest.expenses_today} />
        </div>
      )}

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-right px-3 py-2">Cash</th>
                <th className="text-right px-3 py-2">Bank</th>
                <th className="text-right px-3 py-2">Petty Cash</th>
                <th className="text-right px-3 py-2">Stock Value</th>
                <th className="text-right px-3 py-2">AR</th>
                <th className="text-right px-3 py-2">AP</th>
                <th className="text-right px-3 py-2">Sales</th>
                <th className="text-right px-3 py-2">Collections</th>
                <th className="text-right px-3 py-2">Payments</th>
                <th className="text-right px-3 py-2">Expenses</th>
              </tr>
            </thead>
            <tbody>
              {(snapshots ?? []).map((s) => (
                <tr key={s.id} className="border-t border-line">
                  <td className="px-3 py-2 font-mono text-xs text-ink">{s.snapshot_date}</td>
                  <td className="px-3 py-2 text-right tabular text-ink-soft">{s.cash_in_hand.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular text-ink-soft">{s.bank_balance.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular text-ink-soft">{s.petty_cash_balance.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular text-ink-soft">{s.stock_value.toLocaleString()}</td>
                  <td className={`px-3 py-2 text-right tabular ${s.total_ar_outstanding > 0 ? "text-warn" : "text-ink-soft"}`}>{s.total_ar_outstanding.toLocaleString()}</td>
                  <td className={`px-3 py-2 text-right tabular ${s.total_ap_outstanding > 0 ? "text-warn" : "text-ink-soft"}`}>{s.total_ap_outstanding.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular text-good">{s.sales_today.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular text-good">{s.collections_today.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular text-bad">{s.payments_today.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular text-bad">{s.expenses_today.toLocaleString()}</td>
                </tr>
              ))}
              {!snapshots?.length && (
                <tr>
                  <td colSpan={11} className="px-4 py-6 text-center text-ink-faint">
                    No snapshot yet — the first snapshot will be generated automatically tonight at 00:10, or generate one manually now.
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

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className={`text-2xl font-semibold tabular ${warn && value > 0 ? "text-warn" : "text-ink"}`}>{value.toLocaleString()}</p>
      <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">{label}</p>
    </div>
  );
}
