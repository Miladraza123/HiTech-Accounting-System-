import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";

const STATUS_STYLE: Record<string, string> = {
  Open: "bg-ledger-soft text-ledger",
  Quoted: "bg-warn-soft text-warn",
  Won: "bg-good-soft text-good",
  Lost: "bg-bad-soft text-bad",
  OnHold: "bg-surface-2 text-ink-faint",
};

export default async function QueriesPage() {
  const user = await getCurrentUser();
  const canCreate = isOwner(user) || hasRole(user, "sales");

  const supabase = await createClient();
  const { data: queries } = await supabase
    .from("queries")
    .select("*, parties(legal_name)")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink">Queries</h1>
          <p className="mt-1 text-sm text-ink-soft">Har naya client inquiry yahan se shuru hota hai.</p>
        </div>
        {canCreate && (
          <Link
            href="/queries/new"
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition"
          >
            + Nayi Query
          </Link>
        )}
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-4 py-2.5">Query #</th>
                <th className="text-left px-4 py-2.5">Client</th>
                <th className="text-left px-4 py-2.5">Requirement</th>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-4 py-2.5">Follow-up</th>
                <th className="text-left px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {(queries ?? []).map((q) => (
                <tr key={q.id} className="border-t border-line hover:bg-surface-2">
                  <td className="px-4 py-2.5">
                    <Link href={`/queries/${q.id}`} className="text-accent-ink underline underline-offset-2 font-mono text-xs">
                      {q.query_no}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-ink whitespace-nowrap">{(q.parties as unknown as { legal_name: string } | null)?.legal_name ?? "—"}</td>
                  <td className="px-4 py-2.5 text-ink-soft max-w-xs truncate">{q.requirement}</td>
                  <td className="px-4 py-2.5 text-ink-soft whitespace-nowrap">{q.query_date}</td>
                  <td className="px-4 py-2.5 text-ink-soft whitespace-nowrap">{q.next_followup_at ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[q.status] ?? ""}`}>{q.status}</span>
                  </td>
                </tr>
              ))}
              {!queries?.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-ink-faint">
                    Koi query nahi hai abhi tak.
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
