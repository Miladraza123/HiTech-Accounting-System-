import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { parsePage, pageRange, totalPages as computeTotalPages } from "@/lib/pagination";
import { PaginationControls } from "@/components/PaginationControls";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { describeUserAgent } from "@/lib/userAgent";
import { History } from "lucide-react";

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default async function LoginHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await getCurrentUser();
  // Same visibility rule as the underlying RLS policy on login_sessions
  // itself (Owner + Auditor see everyone's; this page doesn't attempt to
  // show anyone their own history only — that's not a use case here).
  if (!(isOwner(user) || hasRole(user, "auditor"))) redirect("/");

  const { page: pageParam } = await searchParams;
  const page = parsePage(pageParam);
  const [rangeFrom, rangeTo] = pageRange(page);

  const supabase = await createClient();
  const [{ data: sessions, count }, { data: profiles }] = await Promise.all([
    supabase
      .from("login_sessions")
      .select("*", { count: "exact" })
      .order("login_at", { ascending: false })
      .range(rangeFrom, rangeTo),
    supabase.from("profiles").select("id, full_name, email"),
  ]);
  const totalPages = computeTotalPages(count ?? 0);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Login History</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Every sign-in to this system — who, when, and from where. Visible to Owner and Auditor only.
        </p>
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        {sessions?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="text-left px-4 py-2.5">User</th>
                  <th className="text-left px-4 py-2.5">Signed In</th>
                  <th className="text-left px-4 py-2.5">Signed Out</th>
                  <th className="text-left px-4 py-2.5">Device</th>
                  <th className="text-left px-4 py-2.5">IP Address</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const profile = profileById.get(s.user_id);
                  return (
                    <tr key={s.id} className="border-t border-line even:bg-bg">
                      <td className="px-4 py-2.5 text-ink whitespace-nowrap">
                        {profile?.full_name ?? "Unknown user"}
                        <span className="block text-xs text-ink-faint">{profile?.email}</span>
                      </td>
                      <td className="px-4 py-2.5 text-ink-soft whitespace-nowrap text-xs">{formatDateTime(s.login_at)}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-xs">
                        {s.logout_at ? (
                          <span className="text-ink-soft">{formatDateTime(s.logout_at)}</span>
                        ) : (
                          <Badge tone="good">Still signed in</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-ink-soft text-xs" title={s.device_info ?? undefined}>
                        {describeUserAgent(s.device_info)}
                      </td>
                      <td className="px-4 py-2.5 text-ink-soft font-mono text-xs">{s.ip_address ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<History size={22} />} title="No login history yet" description="Sign-ins to this system will show up here." />
        )}
      </div>

      <PaginationControls basePath="/setup/login-history" searchParams={{}} currentPage={page} totalPages={totalPages} totalCount={count ?? 0} />
    </div>
  );
}
