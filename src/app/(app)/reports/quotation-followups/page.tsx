import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { daysSince } from "@/lib/orderHealth";

export default async function QuotationFollowupsPage() {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "sales") || hasRole(user, "accounts") || hasRole(user, "auditor"))) redirect("/");

  const today = new Date().toISOString().slice(0, 10);
  const supabase = await createClient();
  const { data: quotations } = await supabase
    .from("quotations")
    .select("id, quotation_no, status, parties(legal_name), queries!inner(query_no, next_followup_at)")
    .eq("status", "Sent")
    .not("queries.next_followup_at", "is", null)
    .lte("queries.next_followup_at", today)
    .order("created_at", { ascending: false });

  type QueryInfo = { query_no: string; next_followup_at: string | null };
  const rows = (quotations ?? [])
    .map((q) => {
      const party = q.parties as unknown as { legal_name: string } | null;
      const query = q.queries as unknown as QueryInfo;
      return {
        id: q.id,
        quotation_no: q.quotation_no,
        client: party?.legal_name ?? "—",
        query_no: query.query_no,
        followupDate: query.next_followup_at!,
        overdueDays: daysSince(query.next_followup_at!),
      };
    })
    .sort((a, b) => b.overdueDays - a.overdueDays);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/reports" className="text-xs text-ink-faint hover:text-ink">
          ← Reports
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">Quotation Follow-up Due</h1>
        <p className="text-sm text-ink-soft">Sent quotations jinki linked Query par follow-up date aa chuki hai ya guzar chuki hai.</p>
      </div>

      <div className="rounded-xl border border-line bg-surface p-4">
        <p className={`text-2xl font-semibold tabular ${rows.length > 0 ? "text-warn" : "text-ink"}`}>{rows.length}</p>
        <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Follow-ups Due</p>
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-3 py-2">Quotation #</th>
                <th className="text-left px-3 py-2">Query #</th>
                <th className="text-left px-3 py-2">Client</th>
                <th className="text-left px-3 py-2">Follow-up Date</th>
                <th className="text-right px-3 py-2">Din se Due</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-3 py-2 font-mono text-xs text-ink">
                    <Link href={`/quotations/${r.id}`} className="text-accent-ink underline underline-offset-2">
                      {r.quotation_no}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-ink-soft text-xs">{r.query_no}</td>
                  <td className="px-3 py-2 text-ink">{r.client}</td>
                  <td className="px-3 py-2 text-ink-soft">{r.followupDate}</td>
                  <td className={`px-3 py-2 text-right tabular font-medium ${r.overdueDays > 0 ? "text-bad" : "text-warn"}`}>
                    {r.overdueDays > 0 ? r.overdueDays : "Aaj"}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-ink-faint">
                    Koi follow-up due nahi hai.
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
