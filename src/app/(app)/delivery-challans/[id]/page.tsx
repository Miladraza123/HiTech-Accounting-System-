import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PodPanel } from "@/components/PodPanel";
import { CancelDeliveryChallanButton } from "@/components/CancelDeliveryChallanButton";
import { AttachmentsPanel } from "@/components/AttachmentsPanel";

const STATUS_STYLE: Record<string, string> = {
  Issued: "bg-ledger-soft text-ledger",
  Cancelled: "bg-bad-soft text-bad",
};

const ACCEPTANCE_STYLE: Record<string, string> = {
  Pending: "bg-warn-soft text-warn",
  Accepted: "bg-good-soft text-good",
  Disputed: "bg-bad-soft text-bad",
};

export default async function DeliveryChallanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const canManage = await hasPermission(user, "delivery_challan.manage");
  const canDispute = canManage || (await hasPermission(user, "delivery_challan.dispute"));

  const supabase = await createClient();
  const [{ data: dc }, { data: lines }, { data: attachments }] = await Promise.all([
    supabase
      .from("delivery_challans")
      .select("*, parties(legal_name, billing_address), sales_orders(so_no, client_po_number), warehouses(name)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("delivery_challan_lines").select("*").eq("dc_id", id).order("sort_order"),
    supabase.from("attachments").select("*").eq("owner_table", "delivery_challans").eq("owner_id", id).order("uploaded_at", { ascending: false }),
  ]);

  if (!dc) notFound();

  const party = dc.parties as unknown as { legal_name: string; billing_address: string | null } | null;
  const so = dc.sales_orders as unknown as { so_no: string; client_po_number: string } | null;
  const warehouse = dc.warehouses as unknown as { name: string } | null;
  const canCancel = isOwner(user) && dc.status === "Issued";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href="/delivery-challans" className="text-xs text-ink-faint hover:text-ink">
            ← Delivery Challans
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-lg font-semibold text-ink font-mono">{dc.dc_no}</h1>
            <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[dc.status] ?? ""}`}>{dc.status}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${ACCEPTANCE_STYLE[dc.acceptance_status] ?? ""}`}>{dc.acceptance_status}</span>
          </div>
          <p className="text-sm text-ink-soft mt-0.5">
            {party?.legal_name} — SO {so?.so_no} (PO: {so?.client_po_number})
          </p>
        </div>
        <Link
          href={`/delivery-challans/${id}/print`}
          target="_blank"
          className="rounded-md border border-line-strong bg-bg px-3 py-2 text-xs text-ink hover:bg-surface-2 transition whitespace-nowrap"
        >
          Print / PDF
        </Link>
      </div>

      {dc.status === "Cancelled" && dc.cancel_reason && (
        <div className="rounded-md bg-bad-soft border border-bad px-4 py-2 text-sm text-bad">Cancellation reason: {dc.cancel_reason}</div>
      )}
      {dc.acceptance_status === "Disputed" && dc.dispute_note && (
        <div className="rounded-md bg-bad-soft border border-bad px-4 py-2 text-sm text-bad">Dispute note: {dc.dispute_note}</div>
      )}
      {dc.acceptance_status === "Accepted" && (
        <div className="rounded-md bg-good-soft border border-good px-4 py-2 text-sm text-good">
          Accepted by: {dc.accepted_by_name} — {dc.accepted_at ? new Date(dc.accepted_at).toLocaleString("en-PK") : ""}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl border border-line bg-surface p-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Warehouse</p>
              <p className="text-ink mt-0.5">{warehouse?.name ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Delivery Date</p>
              <p className="text-ink mt-0.5">{dc.delivery_date}</p>
            </div>
            {dc.vehicle_no && (
              <div>
                <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Vehicle</p>
                <p className="text-ink mt-0.5">{dc.vehicle_no}</p>
              </div>
            )}
            {dc.driver_name && (
              <div>
                <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Driver</p>
                <p className="text-ink mt-0.5">{dc.driver_name}</p>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-line bg-surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
                  <tr>
                    <th className="text-left px-3 py-2">Description</th>
                    <th className="text-right px-3 py-2">Delivered Qty</th>
                    <th className="text-center px-3 py-2">From Stock?</th>
                  </tr>
                </thead>
                <tbody>
                  {(lines ?? []).map((l) => (
                    <tr key={l.id} className="border-t border-line">
                      <td className="px-3 py-2 text-ink">{l.description}</td>
                      <td className="px-3 py-2 text-right tabular text-ink-soft">
                        {l.delivered_qty} {l.unit}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {l.issue_from_stock ? (
                          <span className="rounded-full bg-good-soft px-2 py-0.5 text-xs text-good">Yes</span>
                        ) : (
                          <span className="text-ink-faint text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {dc.remarks && <p className="text-sm text-ink-soft">Remarks: {dc.remarks}</p>}
        </div>

        <div className="space-y-6">
          {dc.status === "Issued" && dc.acceptance_status === "Pending" && canManage && <PodPanel dcId={id} canDispute={canDispute} />}
          {dc.status === "Issued" && dc.acceptance_status === "Disputed" && canManage && <PodPanel dcId={id} canDispute={canDispute} />}

          {canCancel && (
            <div className="rounded-xl border border-line bg-surface p-4">
              <h2 className="text-sm font-semibold text-ink mb-2">Actions</h2>
              <CancelDeliveryChallanButton dcId={id} />
            </div>
          )}

          <div className="rounded-xl border border-line bg-surface p-4 space-y-2">
            <h2 className="text-sm font-semibold text-ink mb-1">Attachments</h2>
            <AttachmentsPanel ownerTable="delivery_challans" ownerId={id} revalidateTo={`/delivery-challans/${id}`} attachments={attachments ?? []} canManage={canManage} />
          </div>
        </div>
      </div>
    </div>
  );
}
