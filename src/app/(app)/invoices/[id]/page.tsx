import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { CancelInvoiceButton } from "@/components/CancelInvoiceButton";

const STATUS_STYLE: Record<string, string> = {
  Posted: "bg-good-soft text-good",
  Cancelled: "bg-bad-soft text-bad",
};

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const canManage = isOwner(user) || hasRole(user, "accounts");

  const supabase = await createClient();
  const [{ data: invoice }, { data: lines }, { data: outstandingRow }, { data: allocations }] = await Promise.all([
    supabase
      .from("invoices")
      .select("*, parties(legal_name, billing_address, ntn, strn, cnic), sales_orders(so_no, client_po_number)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("invoice_lines").select("*").eq("invoice_id", id).order("sort_order"),
    supabase.from("invoice_outstanding").select("*").eq("invoice_id", id).maybeSingle(),
    supabase.from("payment_allocations").select("*, payments(payment_no, payment_date, status)").eq("invoice_id", id).order("created_at", { ascending: false }),
  ]);

  if (!invoice) notFound();

  const party = invoice.parties as unknown as { legal_name: string; billing_address: string | null; ntn: string | null; strn: string | null; cnic: string | null } | null;
  const so = invoice.sales_orders as unknown as { so_no: string; client_po_number: string } | null;
  const outstanding = outstandingRow?.outstanding_amount ?? 0;
  const canCancel = canManage && invoice.status === "Posted";

  return (
    <div className="space-y-6">
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
        {(party?.ntn || party?.strn || party?.cnic) && (
          <p className="text-xs text-ink-faint mt-0.5">
            {party?.ntn && <>NTN: {party.ntn} </>}
            {party?.strn && <>STRN: {party.strn} </>}
            {party?.cnic && <>CNIC: {party.cnic}</>}
          </p>
        )}
      </div>

      {invoice.status === "Cancelled" && invoice.cancel_reason && (
        <div className="rounded-md bg-bad-soft border border-bad px-4 py-2 text-sm text-bad">Cancel wajah: {invoice.cancel_reason}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl border border-line bg-surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
                  <tr>
                    <th className="text-left px-3 py-2">Description</th>
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
                Payment Record Karen
              </Link>
            )}
          </div>

          {canCancel && (
            <div className="rounded-xl border border-line bg-surface p-4">
              <h2 className="text-sm font-semibold text-ink mb-2">Actions</h2>
              <CancelInvoiceButton invoiceId={id} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
