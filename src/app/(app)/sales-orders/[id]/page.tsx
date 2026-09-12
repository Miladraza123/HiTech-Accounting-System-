import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { SalesOrderAmendPanel } from "@/components/SalesOrderAmendPanel";
import { CancelSalesOrderButton } from "@/components/CancelSalesOrderButton";
import { AttachmentsPanel } from "@/components/AttachmentsPanel";
import { TasksPanel } from "@/components/TasksPanel";

const STATUS_STYLE: Record<string, string> = {
  Confirmed: "bg-ledger-soft text-ledger",
  InProgress: "bg-warn-soft text-warn",
  PartiallyDelivered: "bg-warn-soft text-warn",
  Delivered: "bg-good-soft text-good",
  Invoiced: "bg-good-soft text-good",
  Closed: "bg-surface-2 text-ink-faint",
  Cancelled: "bg-bad-soft text-bad",
};

const BUSINESS_LINE_LABEL: Record<string, string> = {
  material_supply: "Material Supply",
  fabrication: "Fabrication",
};

export default async function SalesOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const canEdit = isOwner(user) || hasRole(user, "sales");

  const supabase = await createClient();
  const [{ data: so }, { data: lines }, { data: revisions }, { data: items }, { data: units }, { data: altUnits }, { data: attachments }, { data: tasks }, { data: profiles }] =
    await Promise.all([
      supabase
        .from("sales_orders")
        .select("*, parties(legal_name, billing_address), queries(query_no), quotations(quotation_no)")
        .eq("id", id)
        .maybeSingle(),
      supabase.from("sales_order_lines").select("*").eq("sales_order_id", id).order("sort_order"),
      supabase.from("sales_order_revisions").select("*").eq("sales_order_id", id).order("rev_no", { ascending: false }),
      supabase.from("items").select("*").eq("is_active", true).order("item_code"),
      supabase.from("units").select("*").order("code"),
      supabase.from("item_alt_units").select("*").eq("is_active", true),
      supabase.from("attachments").select("*").eq("owner_table", "sales_orders").eq("owner_id", id).order("uploaded_at", { ascending: false }),
      supabase.from("tasks").select("*, profiles(full_name)").eq("related_table", "sales_orders").eq("related_id", id).order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    ]);

  if (!so) notFound();

  const party = so.parties as unknown as { legal_name: string; billing_address: string | null } | null;
  const query = so.queries as unknown as { query_no: string } | null;
  const quotation = so.quotations as unknown as { quotation_no: string } | null;
  const canAmend = canEdit && !["Cancelled", "Closed"].includes(so.status);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={quotation ? `/quotations/${so.quotation_id}` : "/quotations"} className="text-xs text-ink-faint hover:text-ink">
            ← {quotation?.quotation_no ?? "Quotation"}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-lg font-semibold text-ink font-mono">{so.so_no}</h1>
            <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[so.status] ?? ""}`}>{so.status}</span>
            <span className="rounded-full bg-ledger-soft px-2 py-0.5 text-xs font-mono text-ledger">
              {BUSINESS_LINE_LABEL[so.business_line]}
            </span>
          </div>
          <p className="text-sm text-ink-soft mt-0.5">{party?.legal_name}</p>
        </div>
      </div>

      {so.status === "Cancelled" && so.cancel_reason && (
        <div className="rounded-md bg-bad-soft border border-bad px-4 py-2 text-sm text-bad">
          Cancel wajah: {so.cancel_reason}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl border border-line bg-surface p-5 grid grid-cols-2 gap-4 text-sm">
            <Field label="Client PO Number" value={so.client_po_number} />
            <Field label="PO Date" value={so.po_date} />
            <Field label="Delivery Schedule" value={so.delivery_schedule ?? "—"} />
            <Field label="Payment Terms" value={so.payment_terms ?? "—"} />
            <Field label="Reference Query" value={query?.query_no ?? "—"} />
          </div>

          <div className="rounded-xl border border-line bg-surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
                  <tr>
                    <th className="text-left px-3 py-2">Description</th>
                    <th className="text-right px-3 py-2">Ordered</th>
                    <th className="text-right px-3 py-2">Delivered</th>
                    <th className="text-right px-3 py-2">Pending</th>
                    <th className="text-right px-3 py-2">Invoiced</th>
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
                      <td className="px-3 py-2 text-right tabular text-ink-soft">{l.delivered_qty}</td>
                      <td className="px-3 py-2 text-right tabular text-ink-soft">{(l.ordered_qty - l.delivered_qty).toFixed(3)}</td>
                      <td className="px-3 py-2 text-right tabular text-ink-soft">{l.invoiced_qty}</td>
                      <td className="px-3 py-2 text-right tabular text-ink-soft">{l.rate}</td>
                      <td className="px-3 py-2 text-right tabular text-ink">{l.amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-6 border-t border-line px-4 py-3 text-sm tabular">
              <span className="text-ink-soft">Subtotal: {so.subtotal}</span>
              <span className="text-ink-soft">Tax: {so.tax_total}</span>
              <span className="font-semibold text-ink">Total: {so.grand_total}</span>
            </div>
          </div>

          {canAmend && (
            <SalesOrderAmendPanel
              salesOrderId={id}
              items={items ?? []}
              units={units ?? []}
              altUnits={altUnits ?? []}
              currentLines={lines ?? []}
              currentClientPo={so.client_po_number}
              currentPoDate={so.po_date}
              currentDeliverySchedule={so.delivery_schedule}
              currentPaymentTerms={so.payment_terms}
            />
          )}
        </div>

        <div className="space-y-6">
          {canAmend && (
            <div className="rounded-xl border border-line bg-surface p-4">
              <h2 className="text-sm font-semibold text-ink mb-2">Actions</h2>
              <CancelSalesOrderButton salesOrderId={id} />
            </div>
          )}

          <div className="rounded-xl border border-line bg-surface p-4 space-y-2">
            <h2 className="text-sm font-semibold text-ink mb-1">Tasks &amp; Follow-ups</h2>
            <TasksPanel
              relatedTable="sales_orders"
              relatedId={id}
              revalidateTo={`/sales-orders/${id}`}
              tasks={(tasks ?? []).map((t) => ({
                id: t.id,
                title: t.title,
                due_date: t.due_date,
                priority: t.priority,
                status: t.status,
                assigned_to: t.assigned_to,
                assignee_name: (t.profiles as unknown as { full_name: string } | null)?.full_name ?? "—",
                created_by: t.created_by,
              }))}
              profiles={profiles ?? []}
              currentUserId={user?.id ?? ""}
              isOwnerUser={isOwner(user)}
              canAdd={!!user}
            />
          </div>

          {!!revisions?.length && (
            <div className="rounded-xl border border-line bg-surface p-4 space-y-2">
              <h2 className="text-sm font-semibold text-ink mb-1">Amendment History</h2>
              {revisions.map((r) => (
                <details key={r.id} className="rounded-md border border-line px-3 py-2 text-sm">
                  <summary className="cursor-pointer font-mono text-xs text-ink">
                    Rev-{r.rev_no} — {new Date(r.created_at).toLocaleDateString("en-PK")}
                  </summary>
                  <p className="mt-1.5 text-xs text-ink-soft">{r.reason}</p>
                  <p className="mt-1 text-[11px] text-ink-faint">Is se pehle wali state mehfooz hai (audit record).</p>
                </details>
              ))}
            </div>
          )}

          <div className="rounded-xl border border-line bg-surface p-4 space-y-2">
            <h2 className="text-sm font-semibold text-ink mb-1">Attachments</h2>
            <AttachmentsPanel
              ownerTable="sales_orders"
              ownerId={id}
              revalidateTo={`/sales-orders/${id}`}
              attachments={attachments ?? []}
              canManage={canEdit}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-ink-faint">{label}</p>
      <p className="text-ink">{value}</p>
    </div>
  );
}
