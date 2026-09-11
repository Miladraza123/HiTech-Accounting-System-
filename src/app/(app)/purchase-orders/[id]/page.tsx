import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { ReceiveGrnPanel } from "@/components/ReceiveGrnPanel";
import { CancelPurchaseOrderButton } from "@/components/CancelPurchaseOrderButton";
import { AttachmentsPanel } from "@/components/AttachmentsPanel";

const STATUS_STYLE: Record<string, string> = {
  Confirmed: "bg-ledger-soft text-ledger",
  PartiallyReceived: "bg-warn-soft text-warn",
  Received: "bg-good-soft text-good",
  Closed: "bg-surface-2 text-ink-faint",
  Cancelled: "bg-bad-soft text-bad",
};

const TYPE_LABEL: Record<string, string> = { direct: "Direct (Client Order)", stock: "Stock", general: "General" };

export default async function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const canEdit = isOwner(user) || hasRole(user, "store");

  const supabase = await createClient();
  const [{ data: po }, { data: lines }, { data: warehouses }, { data: grns }, { data: attachments }] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("*, parties(legal_name, billing_address), sales_orders(so_no)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("purchase_order_lines").select("*").eq("purchase_order_id", id).order("sort_order"),
    supabase.from("warehouses").select("*").eq("is_active", true).order("name"),
    supabase.from("grns").select("*, grn_lines(*)").eq("purchase_order_id", id).order("created_at", { ascending: false }),
    supabase.from("attachments").select("*").eq("owner_table", "purchase_orders").eq("owner_id", id).order("uploaded_at", { ascending: false }),
  ]);

  if (!po) notFound();

  const party = po.parties as unknown as { legal_name: string; billing_address: string | null } | null;
  const linkedSo = po.sales_orders as unknown as { so_no: string } | null;
  const canReceive = canEdit && !["Cancelled", "Closed"].includes(po.status);
  const canCancel = canEdit && po.status === "Confirmed" && !grns?.length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href="/purchase-orders" className="text-xs text-ink-faint hover:text-ink">
            ← Purchase Orders
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-lg font-semibold text-ink font-mono">{po.po_no}</h1>
            <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[po.status] ?? ""}`}>{po.status}</span>
            <span className="rounded-full bg-ledger-soft px-2 py-0.5 text-xs font-mono text-ledger">{TYPE_LABEL[po.purchase_type]}</span>
          </div>
          <p className="text-sm text-ink-soft mt-0.5">{party?.legal_name}</p>
        </div>
        <Link
          href={`/purchase-orders/${id}/print`}
          target="_blank"
          className="rounded-md border border-line-strong bg-bg px-3 py-2 text-xs text-ink hover:bg-surface-2 transition whitespace-nowrap"
        >
          Print / PDF
        </Link>
      </div>

      {po.status === "Cancelled" && po.cancel_reason && (
        <div className="rounded-md bg-bad-soft border border-bad px-4 py-2 text-sm text-bad">Cancel wajah: {po.cancel_reason}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {linkedSo && (
            <div className="text-sm text-ink-soft">
              Client Order:{" "}
              <Link href={`/sales-orders/${po.linked_sales_order_id}`} className="text-accent-ink underline underline-offset-2">
                {linkedSo.so_no}
              </Link>
            </div>
          )}

          <div className="rounded-xl border border-line bg-surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
                  <tr>
                    <th className="text-left px-3 py-2">Description</th>
                    <th className="text-right px-3 py-2">Ordered</th>
                    <th className="text-right px-3 py-2">Received</th>
                    <th className="text-right px-3 py-2">Pending</th>
                    <th className="text-right px-3 py-2">Rate</th>
                    <th className="text-right px-3 py-2">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(lines ?? []).map((l) => (
                    <tr key={l.id} className="border-t border-line">
                      <td className="px-3 py-2 text-ink">{l.description}</td>
                      <td className="px-3 py-2 text-right tabular text-ink-soft">
                        {l.ordered_qty} {l.unit}
                      </td>
                      <td className="px-3 py-2 text-right tabular text-ink-soft">{l.received_qty}</td>
                      <td className="px-3 py-2 text-right tabular text-ink-soft">{(l.ordered_qty - l.received_qty).toFixed(3)}</td>
                      <td className="px-3 py-2 text-right tabular text-ink-soft">{l.rate}</td>
                      <td className="px-3 py-2 text-right tabular text-ink">{l.amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-6 border-t border-line px-4 py-3 text-sm tabular">
              <span className="text-ink-soft">Subtotal: {po.subtotal}</span>
              <span className="text-ink-soft">Tax: {po.tax_total}</span>
              <span className="font-semibold text-ink">Total: {po.grand_total}</span>
            </div>
          </div>

          {canReceive && (
            <ReceiveGrnPanel
              supplierId={po.supplier_id}
              purchaseOrderId={id}
              purchaseType={po.purchase_type}
              defaultWarehouseId={po.warehouse_id}
              warehouses={warehouses ?? []}
              lines={lines ?? []}
            />
          )}

          {!!grns?.length && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-ink">GRN History</h2>
              {grns.map((g) => {
                const gLines = g.grn_lines as unknown as {
                  id: string;
                  this_receipt_qty: number;
                  short_excess_qty: number;
                  ordered_qty: number;
                  total_received_qty: number;
                }[];
                return (
                  <div key={g.id} className="rounded-xl border border-line bg-surface p-4 text-sm space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-ink">{g.grn_no}</span>
                      <span className="text-xs text-ink-faint">{g.received_date}</span>
                    </div>
                    {gLines.map((gl) => (
                      <div key={gl.id} className="flex items-center justify-between text-xs">
                        <span className="text-ink-soft">Received: {gl.this_receipt_qty}</span>
                        {gl.short_excess_qty !== 0 && (
                          <span className={gl.short_excess_qty < 0 ? "text-bad" : "text-warn"}>
                            {gl.short_excess_qty < 0 ? `${Math.abs(gl.short_excess_qty)} Short` : `+${gl.short_excess_qty} Excess`}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-6">
          {canCancel && (
            <div className="rounded-xl border border-line bg-surface p-4">
              <h2 className="text-sm font-semibold text-ink mb-2">Actions</h2>
              <CancelPurchaseOrderButton purchaseOrderId={id} />
            </div>
          )}

          <div className="rounded-xl border border-line bg-surface p-4 space-y-2">
            <h2 className="text-sm font-semibold text-ink mb-1">Attachments</h2>
            <AttachmentsPanel
              ownerTable="purchase_orders"
              ownerId={id}
              revalidateTo={`/purchase-orders/${id}`}
              attachments={attachments ?? []}
              canManage={canEdit}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
