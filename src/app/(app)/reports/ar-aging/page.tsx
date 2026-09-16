import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";

export default async function ArAgingPage() {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "accounts") || hasRole(user, "auditor"))) redirect("/");

  const supabase = await createClient();
  // Was: pull every outstanding invoice, the entire invoices table and the
  // entire parties table, then join and bucket them here. The result is one
  // row per party — bounded — but the input was three growing tables.
  // fn_ar_aging does the join and the bucketing in the database; its
  // fn_aging_bucket mirrors src/lib/aging.ts exactly (verified boundary by
  // boundary against the real JS implementation).
  const { data: aged } = await supabase.rpc("fn_ar_aging");

  const rows = (aged ?? []).map((r) => ({
    partyId: r.party_id,
    name: r.name ?? "—",
    current: r.bucket_current,
    d1_30: r.bucket_1_30,
    d31_60: r.bucket_31_60,
    d61_90: r.bucket_61_90,
    d90_plus: r.bucket_90_plus,
    total: r.total,
  }));

  const grand = rows.reduce(
    (acc, r) => ({
      current: acc.current + r.current,
      d1_30: acc.d1_30 + r.d1_30,
      d31_60: acc.d31_60 + r.d31_60,
      d61_90: acc.d61_90 + r.d61_90,
      d90_plus: acc.d90_plus + r.d90_plus,
      total: acc.total + r.total,
    }),
    { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 }
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href="/reports" className="text-xs text-ink-faint hover:text-ink">
            ← Reports
          </Link>
          <h1 className="text-lg font-semibold text-ink mt-1">AR Aging — Client-wise Outstanding</h1>
        </div>
        <a href="/reports/ar-aging/export" className="rounded-md border border-line-strong bg-bg px-3 py-2 text-xs text-ink hover:bg-surface-2 transition whitespace-nowrap">
          Export to Excel
        </a>
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-3 py-2">Client</th>
                <th className="text-right px-3 py-2">Current</th>
                <th className="text-right px-3 py-2">1-30</th>
                <th className="text-right px-3 py-2">31-60</th>
                <th className="text-right px-3 py-2">61-90</th>
                <th className="text-right px-3 py-2">90+</th>
                <th className="text-right px-3 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.partyId} className="border-t border-line">
                  <td className="px-3 py-2 text-ink">
                    <Link href={`/clients/${r.partyId}`} className="text-accent-ink underline underline-offset-2">
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular text-ink-soft">{r.current.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular text-ink-soft">{r.d1_30.toLocaleString()}</td>
                  <td className={`px-3 py-2 text-right tabular ${r.d31_60 > 0 ? "text-warn" : "text-ink-soft"}`}>{r.d31_60.toLocaleString()}</td>
                  <td className={`px-3 py-2 text-right tabular ${r.d61_90 > 0 ? "text-warn" : "text-ink-soft"}`}>{r.d61_90.toLocaleString()}</td>
                  <td className={`px-3 py-2 text-right tabular ${r.d90_plus > 0 ? "text-bad font-medium" : "text-ink-soft"}`}>{r.d90_plus.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular text-ink font-medium">{r.total.toLocaleString()}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-ink-faint">
                    No outstanding invoices.
                  </td>
                </tr>
              )}
            </tbody>
            {!!rows.length && (
              <tfoot>
                <tr className="border-t-2 border-line-strong bg-surface-2 font-semibold text-ink">
                  <td className="px-3 py-2 text-xs uppercase tracking-wide">Total</td>
                  <td className="px-3 py-2 text-right tabular">{grand.current.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular">{grand.d1_30.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular">{grand.d31_60.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular">{grand.d61_90.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular">{grand.d90_plus.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular">{grand.total.toLocaleString()}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
