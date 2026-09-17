import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { parsePage, pageRange, totalPages as computeTotalPages, DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { PaginationControls } from "@/components/PaginationControls";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { karachiDateKey, karachiDateLabel, karachiTimeLabel } from "@/lib/karachiTime";
import { History, LogIn, LogOut, KeyRound, FilePlus, Pencil, Trash2 } from "lucide-react";

// Every user's every action — sign-ins (with IP), password changes, every
// business document created/updated/deleted, and sign-outs — in one
// chronological feed instead of split across separate pages. Built on top of
// fn_activity_feed(), which combines login_sessions and audit_log (see
// supabase/migrations/..._phase35_01_activity_feed.sql for what feeds it and
// why). Same permission model the old Login-History-only version of this
// page used: Owner + Auditor, matching the RLS already on the underlying
// tables (a non-Owner/Auditor calling the same RPC gets back only their own
// login rows, never anyone else's activity — enforced in the database, not
// just by this redirect).

type ActivityRow = {
  at: string;
  actor_name: string;
  event_type: string;
  summary: string;
  doc_no: string | null;
  detail: string | null;
  ip_address: string | null;
  link_href: string | null;
  total_rows: number;
};

const EVENT_ICON: Record<string, React.ReactNode> = {
  login: <LogIn size={13} />,
  logout: <LogOut size={13} />,
  password: <KeyRound size={13} />,
  insert: <FilePlus size={13} />,
  update: <Pencil size={13} />,
  delete: <Trash2 size={13} />,
};

const EVENT_TONE: Record<string, BadgeTone> = {
  login: "good",
  logout: "neutral",
  password: "warn",
  insert: "good",
  update: "accent",
  delete: "bad",
};

const EVENT_LABEL: Record<string, string> = {
  login: "Sign in",
  logout: "Sign out",
  password: "Password",
  insert: "Created",
  update: "Updated",
  delete: "Deleted",
};

export default async function ActivityLogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await getCurrentUser();
  // Same visibility rule as the RLS policies on audit_log / login_sessions
  // themselves (Owner + Auditor see everyone's; this page doesn't attempt to
  // show anyone their own activity only — that's not a use case here).
  if (!(isOwner(user) || hasRole(user, "auditor"))) redirect("/");

  const { page: pageParam } = await searchParams;
  const page = parsePage(pageParam);
  const [rangeFrom] = pageRange(page);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_activity_feed", { p_limit: DEFAULT_PAGE_SIZE, p_offset: rangeFrom });
  const rows = (data ?? []) as ActivityRow[];
  const totalCount = rows[0]?.total_rows ?? 0;
  const totalPages = computeTotalPages(totalCount);

  // Group this page's rows by their Pakistan-time calendar day. Rows already
  // arrive newest-first from the database, so groups come out in that same
  // order; a day that straddles a page boundary simply gets its heading
  // repeated on both pages, same as any other date-grouped, paginated list.
  const groups: { dateKey: string; dateLabel: string; rows: ActivityRow[] }[] = [];
  for (const row of rows) {
    const dateKey = karachiDateKey(row.at);
    const last = groups[groups.length - 1];
    if (last && last.dateKey === dateKey) {
      last.rows.push(row);
    } else {
      groups.push({ dateKey, dateLabel: karachiDateLabel(row.at), rows: [row] });
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Activity Log</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Every sign-in, password change and business action, for every user — one combined timeline, in Pakistan Standard
          Time. Visible to Owner and Auditor only.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-bad bg-bad-soft px-4 py-3 text-sm text-bad">
          Could not load the activity log: {error.message}
        </div>
      )}

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="text-left px-4 py-2.5 whitespace-nowrap">Time (PKT)</th>
                  <th className="text-left px-4 py-2.5">User</th>
                  <th className="text-left px-4 py-2.5">Event</th>
                  <th className="text-left px-4 py-2.5">Detail</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <ActivityDayGroup key={group.dateKey} group={group} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<History size={22} />} title="No activity yet" description="Sign-ins and actions in this system will show up here." />
        )}
      </div>

      <PaginationControls basePath="/setup/login-history" searchParams={{}} currentPage={page} totalPages={totalPages} totalCount={totalCount} />
    </div>
  );
}

function ActivityDayGroup({ group }: { group: { dateKey: string; dateLabel: string; rows: ActivityRow[] } }) {
  return (
    <>
      <tr className="border-t border-line bg-surface-2">
        <td colSpan={4} className="px-4 py-1.5 text-xs font-mono font-semibold uppercase tracking-wide text-ink-soft">
          {group.dateLabel}
        </td>
      </tr>
      {group.rows.map((row, i) => (
        <ActivityRowView key={`${row.at}-${row.actor_name}-${i}`} row={row} />
      ))}
    </>
  );
}

function ActivityRowView({ row }: { row: ActivityRow }) {
  const tone = EVENT_TONE[row.event_type] ?? "neutral";
  const icon = EVENT_ICON[row.event_type];
  const label = EVENT_LABEL[row.event_type] ?? row.event_type;

  return (
    <tr className="border-t border-line even:bg-bg">
      <td className="px-4 py-2.5 text-ink-soft font-mono text-xs whitespace-nowrap align-top">{karachiTimeLabel(row.at)}</td>
      <td className="px-4 py-2.5 text-ink whitespace-nowrap align-top">{row.actor_name}</td>
      <td className="px-4 py-2.5 align-top">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone={tone}>
            <span className="flex items-center gap-1">
              {icon}
              {label}
            </span>
          </Badge>
          <span className="text-ink text-xs">{row.summary}</span>
          {row.doc_no &&
            (row.link_href ? (
              <Link href={row.link_href} className="text-accent-ink underline underline-offset-2 font-mono text-xs">
                {row.doc_no}
              </Link>
            ) : (
              <span className="text-ink-soft font-mono text-xs">{row.doc_no}</span>
            ))}
        </div>
      </td>
      <td className="px-4 py-2.5 text-ink-faint text-xs align-top">
        {row.detail}
        {row.ip_address && (
          <span className={row.detail ? "ml-2" : undefined}>
            IP: <span className="font-mono">{row.ip_address}</span>
          </span>
        )}
      </td>
    </tr>
  );
}
