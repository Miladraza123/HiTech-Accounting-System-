import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";

// A client is flagged once outstanding crosses this fraction of their credit
// limit — "Warning" before they're actually over, "Over Limit" once they are.
const WARNING_THRESHOLD = 0.9;

export default async function CreditLimitWarningPage() {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "accounts") || hasRole(user, "sales") || hasRole(user, "auditor"))) redirect("/");

  const supabase = await createClient();
  const [{ data: parties }, { data: arSummary }] = await Promise.all([
    supabase.from("parties").select("id, legal_name, credit_limit, credit_days").in("party_type", ["client", "both"]).gt("credit_limit", 0),
    supabase.from("party_ar_summary").select("*"),
  ]);

  const outstandingById = new Map((arSummary ?? []).map((s) => [s.party_id, s.total_outstanding ?? 0]));

  const rows = (parties ?? [])
    .map((p) => {
      const outstanding = outstandingById.get(p.id) ?? 0;
      const pct = p.credit_limit > 0 ? outstanding / p.credit_limit : 0;
      return { ...p, outstanding, pct };
    })
    .filter((r) => r.pct >= WARNING_THRESHOLD)
    .sort((a, b) => b.pct - a.pct);

  const overLimitCount = rows.filter((r) => r.pct >= 1).length;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/reports" className="text-xs text-ink-faint hover:text-ink">
          ← Reports
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">Credit Limit Warning</h1>
        <p className="text-sm text-ink-soft">Every client whose outstanding has reached 90% or more of their Credit Limit.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className={`text-2xl font-semibold tabular ${rows.length > 0 ? "text-warn" : "text-ink"}`}>{rows.length}</p>
          <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Clients Near/Over Limit</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className={`text-2xl font-semibold tabular ${overLimitCount > 0 ? "text-bad" : "text-ink"}`}>{overLimitCount}</p>
          <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Clients Over Limit</p>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-3 py-2">Client</th>
                <th className="text-right px-3 py-2">Credit Limit</th>
                <th className="text-right px-3 py-2">Outstanding</th>
                <th className="text-right px-3 py-2">% Used</th>
                <th className="text-left px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-3 py-2 text-ink">
                    <Link href={`/clients/${r.id}`} className="text-accent-ink underline underline-offset-2">
                      {r.legal_name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular text-ink-soft">{r.credit_limit.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular text-ink">{r.outstanding.toLocaleString()}</td>
                  <td className={`px-3 py-2 text-right tabular font-medium ${r.pct >= 1 ? "text-bad" : "text-warn"}`}>
                    {Math.round(r.pct * 100)}%
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${r.pct >= 1 ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn"}`}>
                      {r.pct >= 1 ? "Over Limit" : "Warning"}
                    </span>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-ink-faint">
                    No client is near or over their Credit Limit.
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
