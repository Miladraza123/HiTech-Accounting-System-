import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { ActivityTimeline } from "@/components/ActivityTimeline";
import { AttachmentsPanel } from "@/components/AttachmentsPanel";
import { QueryStatusActions } from "@/components/QueryStatusActions";
import { buttonClass } from "@/components/ui/Button";

const STATUS_STYLE: Record<string, string> = {
  Open: "bg-ledger-soft text-ledger",
  Quoted: "bg-warn-soft text-warn",
  Won: "bg-good-soft text-good",
  Lost: "bg-bad-soft text-bad",
  OnHold: "bg-surface-2 text-ink-faint",
};

export default async function QueryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const canEdit = await hasPermission(user, "query.manage");

  const supabase = await createClient();
  const [{ data: query }, { data: events }, { data: attachments }, { data: quotations }, { data: profiles }] =
    await Promise.all([
      supabase.from("queries").select("*, parties(legal_name, billing_address), query_sources(name)").eq("id", id).maybeSingle(),
      supabase.from("activity_timeline").select("*").eq("owner_table", "queries").eq("owner_id", id).order("at", { ascending: false }),
      supabase.from("attachments").select("*").eq("owner_table", "queries").eq("owner_id", id).order("uploaded_at", { ascending: false }),
      supabase.from("quotations").select("id, quotation_no, status, created_at").eq("query_id", id).order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, full_name"),
    ]);

  if (!query) notFound();

  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const eventsWithNames = (events ?? []).map((e) => ({
    id: e.id,
    event_type: e.event_type,
    note: e.note,
    at: e.at,
    actor_name: (e.actor_id && nameById.get(e.actor_id)) || "System",
  }));

  const party = query.parties as unknown as { legal_name: string; billing_address: string | null } | null;
  const source = query.query_sources as unknown as { name: string } | null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/queries" className="text-xs text-ink-faint hover:text-ink">
          ← Queries
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold text-ink font-mono">{query.query_no}</h1>
          <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[query.status] ?? ""}`}>{query.status}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-xl border border-line bg-surface p-5 space-y-3">
            <Row label="Client" value={party?.legal_name ?? "—"} />
            <Row label="Requirement" value={query.requirement} />
            <Row label="Source" value={source?.name ?? "—"} />
            <Row label="Query Date" value={query.query_date} />
            <Row label="Follow-up" value={query.next_followup_at ?? "—"} />
            {query.notes && <Row label="Notes" value={query.notes} />}
          </div>

          <div>
            <h2 className="text-sm font-semibold text-ink mb-2">Activity &amp; Follow-ups</h2>
            <ActivityTimeline
              ownerTable="queries"
              ownerId={id}
              revalidateTo={`/queries/${id}`}
              events={eventsWithNames}
              canAdd={canEdit}
            />
          </div>
        </div>

        <div className="space-y-6">
          {canEdit && (
            <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
              <h2 className="text-sm font-semibold text-ink">Actions</h2>
              <Link href={`/quotations/new?query_id=${id}`} className={`block text-center ${buttonClass()}`}>
                + New Quotation
              </Link>
              <QueryStatusActions queryId={id} currentStatus={query.status} />
            </div>
          )}

          {quotations && quotations.length > 0 && (
            <div className="rounded-xl border border-line bg-surface p-4 space-y-2">
              <h2 className="text-sm font-semibold text-ink mb-1">Quotations</h2>
              {quotations.map((q) => (
                <Link
                  key={q.id}
                  href={`/quotations/${q.id}`}
                  className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-sm hover:bg-surface-2 transition"
                >
                  <span className="font-mono text-xs text-accent-ink">{q.quotation_no}</span>
                  <span className="text-xs text-ink-faint">{q.status}</span>
                </Link>
              ))}
            </div>
          )}

          <div className="rounded-xl border border-line bg-surface p-4 space-y-2">
            <h2 className="text-sm font-semibold text-ink mb-1">Attachments</h2>
            <AttachmentsPanel
              ownerTable="queries"
              ownerId={id}
              revalidateTo={`/queries/${id}`}
              attachments={attachments ?? []}
              canManage={canEdit}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="w-28 shrink-0 text-ink-faint">{label}</span>
      <span className="text-ink">{value}</span>
    </div>
  );
}
