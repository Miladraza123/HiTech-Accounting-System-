import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { DraftQuotationEditor } from "@/components/DraftQuotationEditor";
import { CreateRevisionPanel } from "@/components/CreateRevisionPanel";
import { QuotationRevisionView } from "@/components/QuotationRevisionView";
import { AttachmentsPanel } from "@/components/AttachmentsPanel";
import { PrintPdfActions } from "@/components/PrintPdfActions";
import { buttonClass } from "@/components/ui/Button";

const STATUS_STYLE: Record<string, string> = {
  Draft: "bg-surface-2 text-ink-faint",
  Sent: "bg-warn-soft text-warn",
  Accepted: "bg-good-soft text-good",
  Rejected: "bg-bad-soft text-bad",
  Expired: "bg-bad-soft text-bad",
};

export default async function QuotationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ rev?: string }>;
}) {
  const { id } = await params;
  const { rev } = await searchParams;
  const user = await getCurrentUser();
  const canEdit = await hasPermission(user, "quotation.manage");

  const supabase = await createClient();
  const [{ data: quotation }, { data: revisions }, { data: items }, { data: units }, { data: attachments }, { data: salesOrders }, { data: company }] =
    await Promise.all([
      supabase.from("quotations").select("*, parties(legal_name), queries(query_no)").eq("id", id).maybeSingle(),
      supabase.from("quotation_revisions").select("*").eq("quotation_id", id).order("rev_no", { ascending: false }),
      supabase.from("items").select("*").eq("is_active", true).order("item_code"),
      supabase.from("units").select("*").order("code"),
      supabase.from("attachments").select("*").eq("owner_table", "quotations").eq("owner_id", id).order("uploaded_at", { ascending: false }),
      supabase.from("sales_orders").select("id, so_no, status").eq("quotation_id", id).order("created_at", { ascending: false }),
      supabase.from("company").select("signature_path, stamp_path, phone, email").maybeSingle(),
    ]);

  if (!quotation || !revisions?.length) notFound();

  const currentRevision = revisions.find((r) => r.is_current)!;
  const selectedRevision = rev ? revisions.find((r) => r.rev_no === Number(rev)) ?? currentRevision : currentRevision;
  const isViewingCurrent = selectedRevision.id === currentRevision.id;

  const { data: lines } = await supabase
    .from("quotation_lines")
    .select("*")
    .eq("revision_id", selectedRevision.id)
    .order("sort_order");

  const party = quotation.parties as unknown as { legal_name: string } | null;
  const query = quotation.queries as unknown as { query_no: string } | null;
  const showDraftEditor = canEdit && isViewingCurrent && quotation.status === "Draft";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={query ? `/queries/${quotation.query_id}` : "/queries"} className="text-xs text-ink-faint hover:text-ink">
            ← {query?.query_no ?? "Query"}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-lg font-semibold text-ink font-mono">{quotation.quotation_no}</h1>
            <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[quotation.status] ?? ""}`}>{quotation.status}</span>
            <span className="text-xs text-ink-faint">Rev-{selectedRevision.rev_no}</span>
          </div>
          <p className="text-sm text-ink-soft mt-0.5">{party?.legal_name}</p>
        </div>
        <PrintPdfActions
          printPath={`/quotations/${id}/print`}
          filename={`${quotation.quotation_no}.pdf`}
          hasSignature={!!company?.signature_path}
          hasStamp={!!company?.stamp_path}
          hasPhone={!!company?.phone}
          hasEmail={!!company?.email}
        />
      </div>

      {!isViewingCurrent && (
        <div className="rounded-md bg-warn-soft border border-warn px-4 py-2 text-sm text-warn">
          You are viewing an old revision (Rev-{selectedRevision.rev_no}) — this is read-only.{" "}
          <Link href={`/quotations/${id}`} className="underline underline-offset-2 font-medium">
            Go back to current revision
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {showDraftEditor ? (
            <DraftQuotationEditor
              quotationId={id}
              items={items ?? []}
              units={units ?? []}
              initialLines={lines ?? []}
              initialTerms={selectedRevision.terms}
              initialValidity={selectedRevision.validity_date}
              initialDeliveryTerms={selectedRevision.delivery_terms}
              initialPaymentTerms={selectedRevision.payment_terms}
            />
          ) : (
            <>
              <QuotationRevisionView revision={selectedRevision} lines={lines ?? []} />
              {canEdit && isViewingCurrent && quotation.status !== "Draft" && (
                <CreateRevisionPanel
                  quotationId={id}
                  items={items ?? []}
                  units={units ?? []}
                  currentLines={lines ?? []}
                  currentTerms={selectedRevision.terms}
                  currentValidity={selectedRevision.validity_date}
                  currentDeliveryTerms={selectedRevision.delivery_terms}
                  currentPaymentTerms={selectedRevision.payment_terms}
                />
              )}
            </>
          )}
        </div>

        <div className="space-y-6">
          {canEdit && quotation.status !== "Draft" && (
            <div className="rounded-xl border border-line bg-surface p-4 space-y-2">
              <h2 className="text-sm font-semibold text-ink mb-1">Sales Order</h2>
              {(salesOrders ?? []).map((so) => (
                <Link
                  key={so.id}
                  href={`/sales-orders/${so.id}`}
                  className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-sm hover:bg-surface-2 transition"
                >
                  <span className="font-mono text-xs text-accent-ink">{so.so_no}</span>
                  <span className="text-xs text-ink-faint">{so.status}</span>
                </Link>
              ))}
              <Link href={`/sales-orders/new?quotation_id=${id}`} className={`block text-center ${buttonClass()}`}>
                + Client PO Received — New Sales Order
              </Link>
            </div>
          )}

          <div className="rounded-xl border border-line bg-surface p-4 space-y-2">
            <h2 className="text-sm font-semibold text-ink mb-1">Revision History</h2>
            {revisions.map((r) => (
              <Link
                key={r.id}
                href={r.is_current ? `/quotations/${id}` : `/quotations/${id}?rev=${r.rev_no}`}
                className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm transition ${
                  r.id === selectedRevision.id ? "border-accent bg-accent-soft/30" : "border-line hover:bg-surface-2"
                }`}
              >
                <span className="font-mono text-xs">
                  Rev-{r.rev_no} {r.is_current && <span className="text-ink-faint">(current)</span>}
                </span>
                <span className="text-xs text-ink-soft tabular">{r.grand_total}</span>
              </Link>
            ))}
          </div>

          <div className="rounded-xl border border-line bg-surface p-4 space-y-2">
            <h2 className="text-sm font-semibold text-ink mb-1">Attachments</h2>
            <AttachmentsPanel
              ownerTable="quotations"
              ownerId={id}
              revalidateTo={`/quotations/${id}`}
              attachments={attachments ?? []}
              canManage={canEdit}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
