import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { buttonClass } from "@/components/ui/Button";

export default async function JournalVouchersPage() {
  const user = await getCurrentUser();
  const canView = isOwner(user) || hasRole(user, "accounts") || hasRole(user, "auditor");
  if (!canView) redirect("/");
  const canCreate = await hasPermission(user, "journal_voucher.manage");

  const supabase = await createClient();
  const { data: entries } = await supabase
    .from("journal_entries")
    .select("*, journal_lines(*, chart_of_accounts(code, name))")
    .eq("source_table", "manual")
    .order("entry_date", { ascending: false })
    .limit(100);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink">Journal Vouchers</h1>
          <p className="mt-1 text-sm text-ink-soft">Manual entries — jo Payment/Expense/Transfer screens se automatic nahi bantay.</p>
        </div>
        {canCreate && (
          <Link href="/journal-vouchers/new" className={buttonClass()}>
            + New Journal Voucher
          </Link>
        )}
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-3 py-2">Entry #</th>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-left px-3 py-2">Narration</th>
                <th className="text-right px-3 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {(entries ?? []).map((e) => {
                const lines = e.journal_lines as unknown as { debit: number; credit: number }[];
                const total = lines.reduce((s, l) => s + l.debit, 0);
                return (
                  <tr key={e.id} className="border-t border-line">
                    <td className="px-3 py-2 font-mono text-xs text-ink">{e.entry_no}</td>
                    <td className="px-3 py-2 text-ink-faint text-xs">{e.entry_date}</td>
                    <td className="px-3 py-2 text-ink-soft">{e.narration}</td>
                    <td className="px-3 py-2 text-right tabular text-ink">{total.toLocaleString()}</td>
                  </tr>
                );
              })}
              {!entries?.length && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-ink-faint">
                    Koi manual Journal Voucher nahi bana abhi tak.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-ink-faint">
        Sab transactions (manual + automatic) ek din ke liye{" "}
        <Link href="/reports/daily-ledger" className="text-accent-ink underline underline-offset-2">
          Daily Ledger
        </Link>{" "}
        mein dekh sakte hain.
      </p>
    </div>
  );
}
