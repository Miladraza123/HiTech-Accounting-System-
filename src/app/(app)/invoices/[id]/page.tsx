import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { canSeeInvoices } from "@/lib/financeAccess";
import { hasPermission } from "@/lib/permissions";
import { CancelInvoiceButton } from "@/components/CancelInvoiceButton";
import { SalesReturnPanel } from "@/components/SalesReturnPanel";
import { CancelSalesReturnButton } from "@/components/CancelSalesReturnButton";
import { PrintPdfActions } from "@/components/PrintPdfActions";

const STATUS_STYLE: Record<string, string> = {
  Posted: "bg-good-soft text-good",
  Cancelled: "bg-bad-soft text-bad",
};

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!canSeeInvoices(user)) redirect("/");
  const canManage = await hasPermission(user, "invoice.manage");

  const supabase = await createClient();
  const [{ data: invoice }, { data: lines }, { data: outstandingRow }, { data: allocations }, { data: warehouses }, { data: returns }, { data: company }] = await Promise.all([
    supabase
      .from("invoices")
      .select(
        "*, parties(legal_name, billing_address, ntn, strn, cnic), sales_orders(so_no, client_po_number, quotation_id, query_id, quotations(quotation_no), queries(query_no))"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("invoice_lines").select("*").eq("invoice_id", id).order("sort_order"),
    supabase.from("invoice_outstanding").select("*").eq("invoice_id", id).maybeSingle(),
    supabase.from("payment_allocations").select("*, payments(payment_no, payment_date, status)").eq("invoice_id", id).order("created_at", { ascending: false }),
    supabase.from("warehouses").select("*").eq("is_active", true).order("name"),
    supabase.from("sales_returns").select("*").eq("invoice_id", id).order("created_at", { ascending: false }),
    supabase.from("company").select("signature_path, stamp_path, phone, email").maybeSingle(),
  ]);

  if (!invoice) notFound();

  const party = invoice.parties as unknown as { legal_name: string; billing_address: string | null; ntn: string | null; strn: string | null; cnic: string | null } | null;
  const so = invoice.sales_orders as unknown as {
    so_no: string;
    client_po_number: string;
    quotation_id: string | null;
    query_id: string | null;
    quotations: { quotation_no: string } | null;
    queries: { query_no: string } | null;
  } | null;
  const quotation = so?.quotations ?? null;
  const query = so?.queries ?? null;

  // The document trail (Query/Quotation/PO) is one hop further than this
  // invoice's own row reaches — sales_orders denormalizes query_id/quotation_id,
  // but delivery_challans and purchase_orders only point UP at a sales order,
  // never down at an invoice — so they're found by searching for this invoice's
  // sales_order_id, not by any column on the invoice itself.
  const [{ data: deliveryChallans }, { data: linkedPurchaseOrders }] = invoice.sales_order_id
    ? await Promise.all([
        supabase
          .from("delivery_challans")
          .select("id, dc_no")
          .eq("sales_order_id", invoice.sales_order_id)
          .order("created_at", { ascending: false }),
        supabase
          .from("purchase_orders")
          .select("id, po_no")
          .eq("linked_sales_order_id", invoice.sales_order_id)
          .eq("purchase_type", "direct")
          .order("created_at", { ascending: false }),
      ])
    : [{ data: null }, { data: null }];

  const outstanding = outstandingRow?.outstanding_amount ?? 0;
  const canCancel = canManage && invoice.status === "Posted";
  const canReturn = (await hasPermission(user, "sales_return.manage")) && invoice.status === "Posted";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href="/invoices" className="text-xs text-ink-faint hover:text-ink">
            ← GST Invoices
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-lg font-semibold text-ink font-mono">{invoice.invoice_no}</h1>
            <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[invoice.status] ?? ""}`}>{invoice.status}</span>
          </div>
          <p className="text-sm text-ink-soft mt-0.5">
            {party?.legal_name} — SO {so?.so_no} (PO: {so?.client_po_number})
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs">
            {query && invoice.sales_order_id && (
              <>
                <Link href={`/queries/${so?.query_id}`} className="font-mono text-ink-faint hover:text-ink underline underline-offset-2">
                  {query.query_no}
                </Link>
                <span className="text-ink-faint">→</span>
              </>
            )}
            {quotation && invoice.sales_order_id && (
              <>
                <Link href={`/quotations/${so?.quotation_id}`} className="font-mono text-ink-faint hover:text-ink underline underline-offset-2">
                  {quotation.quotation_no}
                </Link>
                <span className="text-ink-faint">→</span>
              </>
            )}
            {so && invoice.sales_order_id && (
              <>
                <Link href={`/sales-orders/${invoice.sales_order_id}`} className="font-mono text-ink-faint hover:text-ink underline underline-offset-2">
                  {so.so_no}
                </Link>
                <span className="text-ink-faint">→</span>
              </>
            )}
            {(deliveryChallans ?? []).map((dc) => (
              <Link key={dc.id} href={`/delivery-challans/${dc.id}`} className="font-mono text-ink-faint hover:text-ink underline underline-offset-2">
                {dc.dc_no}
              </Link>
            ))}
            {!!deliveryChallans?.length && <span className="text-ink-faint">→</span>}
            <span className="font-mono text-ink font-medium">{invoice.invoice_no}</span>
            {!!linkedPurchaseOrders?.length && (
              <>
                <span className="text-ink-faint ml-1">· PO:</span>
                {linkedPurchaseOrders.map((po) => (
                  <Link key={po.id} href={`/purchase-orders/${po.id}`} className="font-mono text-ledger hover:underline underline-offset-2">
                    {po.po_no}
                  </Link>
                ))}
              </>
            )}
          </div>
          {(party?.ntn || party?.strn || party?.cnic) && (
            <p className="text-xs text-ink-faint mt-0.5">
              {party?.ntn && <>NTN: {party.ntn} </>}
              {party?.strn && <>STRN: {party.strn} </>}
              {party?.cnic && <>CNIC: {party.cnic}</>}
            </p>
          )}
        </div>
        <PrintPdfActions
          printPath={`/invoices/${id}/print`}
          filename={`${invoice.invoice_no}.pdf`}
          hasSignature={!!company?.signature_path}
          hasStamp={!!company?.stamp_path}
          hasPhone={!!company?.phone}
          hasEmail={!!company?.email}
        />
      </div>

      {invoice.status === "Cancelled" && invoice.cancel_reason && (
        <div className="rounded-md bg-bad-soft border border-bad px-4 py-2 text-sm text-bad">Cancellation reason: {invoice.cancel_reason}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl border border-line bg-surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
                  <tr>
                    <th className="text-left px-3 py-2">Description</th>
                    <th className="text-left px-3 py-2">HS Code</th>
                    <th className="text-right px-3 py-2">Qty</th>
                    <th className="text-right px-3 py-2">Rate</th>
                    <th className="text-right px-3 py-2">Tax %</th>
                    <th className="text-right px-3 py-2">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(lines ?? []).map((l) => (
                    <tr key={l.id} className="border-t border-line">
                      <td className="px-3 py-2 text-ink">{l.description}</td>
                      <td className="px-3 py-2 text-ink-soft">{l.hs_code || "—"}</td>
                      <td className="px-3 py-2 text-right tabular text-ink-soft">
                        {l.qty} {l.unit}
                      </td>
                      <td className="px-3 py-2 text-right tabular text-ink-soft">{l.rate}</td>
                      <td className="px-3 py-2 text-right tabular text-ink-soft">{l.tax_pct}</td>
                      <td className="px-3 py-2 text-right tabular text-ink">{l.amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-6 border-t border-line px-4 py-3 text-sm tabular">
              <span className="text-ink-soft">Subtotal: {invoice.subtotal}</span>
              <span className="text-ink-soft">Tax: {invoice.tax_total}</span>
              <span className="font-semibold text-ink">Total: {invoice.grand_total}</span>
            </div>
          </div>

          {!!allocations?.length && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-ink">Payment History</h2>
              <div className="rounded-xl border border-line bg-surface overflow-hidden divide-y divide-line">
                {allocations.map((a) => {
                  const pay = a.payments as unknown as { payment_no: string; payment_date: string; status: string } | null;
                  return (
                    <div key={a.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <div>
                        <Link href={`/payments`} className="text-accent-ink underline underline-offset-2 font-mono text-xs">
                          {pay?.payment_no}
                        </Link>
                        <span className="text-ink-faint text-xs ml-2">{pay?.payment_date}</span>
                        {pay?.status === "Cancelled" && <span className="ml-2 rounded-full bg-bad-soft px-2 py-0.5 text-xs text-bad">Cancelled</span>}
                      </div>
                      <span className="tabular text-ink">{a.amount.toLocaleString()}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!!returns?.length && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-ink">Sales Returns</h2>
              <div className="rounded-xl border border-line bg-surface overflow-hidden divide-y divide-line">
                {returns.map((r) => (
                  <div key={r.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <div>
                      <Link href={`/sales-returns/${r.id}`} className="text-accent-ink underline underline-offset-2 font-mono text-xs">
                        {r.return_no}
                      </Link>
                      <span className="text-ink-faint text-xs ml-2">{r.return_date}</span>
                      {r.status === "Cancelled" && <span className="ml-2 rounded-full bg-bad-soft px-2 py-0.5 text-xs text-bad">Cancelled</span>}
                    </div>
                    <span className="tabular text-ink">{r.grand_total.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {canReturn && <SalesReturnPanel invoiceId={id} warehouses={warehouses ?? []} lines={lines ?? []} />}
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-line bg-surface p-4 space-y-2">
            <h2 className="text-sm font-semibold text-ink mb-1">Recovery</h2>
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-soft">Outstanding</span>
              <span className={`tabular font-semibold ${outstanding > 0 ? "text-warn" : "text-good"}`}>
                {invoice.status === "Posted" ? outstanding.toLocaleString() : "—"}
              </span>
            </div>
            {invoice.status === "Posted" && outstanding > 0 && canManage && (
              <Link href={`/payments/new?party=${invoice.party_id}&direction=receipt`} className="block text-center rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition">
                Record Payment
              </Link>
            )}
          </div>

          {canCancel && (
            <div className="rounded-xl border border-line bg-surface p-4">
              <h2 className="text-sm font-semibold text-ink mb-2">Actions</h2>
              <CancelInvoiceButton invoiceId={id} />
            </div>
          )}

          {!!returns?.filter((r) => r.status === "Posted").length && canReturn && (
            <div className="rounded-xl border border-line bg-surface p-4 space-y-2">
              <h2 className="text-sm font-semibold text-ink mb-1">Sales Return Actions</h2>
              {returns
                .filter((r) => r.status === "Posted")
                .map((r) => (
                  <div key={r.id} className="space-y-1">
                    <p className="text-xs text-ink-faint font-mono">{r.return_no}</p>
                    <CancelSalesReturnButton returnId={r.id} invoiceId={id} />
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
