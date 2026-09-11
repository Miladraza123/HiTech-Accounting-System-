import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { AllocatePaymentPanel } from "@/components/AllocatePaymentPanel";
import { CancelPaymentButton } from "@/components/CancelPaymentButton";

const STATUS_STYLE: Record<string, string> = {
  Posted: "bg-good-soft text-good",
  Cancelled: "bg-bad-soft text-bad",
};

const DIRECTION_LABEL: Record<string, string> = { receipt: "Receipt — Client se aaya", payment: "Payment — Supplier ko gaya" };

export default async function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const canManage = isOwner(user) || hasRole(user, "accounts");

  const supabase = await createClient();
  const [{ data: payment }, { data: allocations }] = await Promise.all([
    supabase.from("payments").select("*, parties(legal_name)").eq("id", id).maybeSingle(),
    supabase.from("payment_allocations").select("*").eq("payment_id", id).order("created_at", { ascending: false }),
  ]);

  if (!payment) notFound();

  const party = payment.parties as unknown as { legal_name: string } | null;
  const canCancel = canManage && payment.status === "Posted";

  let allocRows: { key: string; label: string; date: string; outstanding: number }[] = [];
  const invoiceIds = (allocations ?? []).map((a) => a.invoice_id).filter(Boolean) as string[];
  const billIds = (allocations ?? []).map((a) => a.supplier_bill_id).filter(Boolean) as string[];
  const [{ data: invoices }, { data: bills }] = await Promise.all([
    invoiceIds.length ? supabase.from("invoices").select("id, invoice_no").in("id", invoiceIds) : Promise.resolve({ data: [] }),
    billIds.length ? supabase.from("supplier_bills").select("id, bill_no").in("id", billIds) : Promise.resolve({ data: [] }),
  ]);
  const invoiceNoById = new Map((invoices ?? []).map((i) => [i.id, i.invoice_no]));
  const billNoById = new Map((bills ?? []).map((b) => [b.id, b.bill_no]));

  if (payment.status === "Posted" && payment.unallocated_amount > 0) {
    if (payment.direction === "receipt") {
      const { data: outstanding } = await supabase.from("invoice_outstanding").select("*").eq("party_id", payment.party_id).gt("outstanding_amount", 0);
      const { data: allInvoices } = await supabase.from("invoices").select("id, invoice_no, invoice_date").eq("party_id", payment.party_id);
      const invById = new Map((allInvoices ?? []).map((i) => [i.id, i]));
      allocRows = (outstanding ?? []).map((o) => ({
        key: o.invoice_id!,
        label: invById.get(o.invoice_id!)?.invoice_no ?? "",
        date: invById.get(o.invoice_id!)?.invoice_date ?? "",
        outstanding: o.outstanding_amount ?? 0,
      }));
    } else {
      const { data: outstanding } = await supabase.from("supplier_bill_outstanding").select("*").eq("supplier_id", payment.party_id).gt("outstanding_amount", 0);
      const { data: allBills } = await supabase.from("supplier_bills").select("id, bill_no, bill_date").eq("supplier_id", payment.party_id);
      const billById2 = new Map((allBills ?? []).map((b) => [b.id, b]));
      allocRows = (outstanding ?? []).map((o) => ({
        key: o.supplier_bill_id!,
        label: billById2.get(o.supplier_bill_id!)?.bill_no ?? "",
        date: billById2.get(o.supplier_bill_id!)?.bill_date ?? "",
        outstanding: o.outstanding_amount ?? 0,
      }));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/payments" className="text-xs text-ink-faint hover:text-ink">
          ← Payments
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold text-ink font-mono">{payment.payment_no}</h1>
          <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[payment.status] ?? ""}`}>{payment.status}</span>
        </div>
        <p className="text-sm text-ink-soft mt-0.5">
          {party?.legal_name} — {DIRECTION_LABEL[payment.direction]}
        </p>
      </div>

      {payment.status === "Cancelled" && payment.cancel_reason && (
        <div className="rounded-md bg-bad-soft border border-bad px-4 py-2 text-sm text-bad">Cancel wajah: {payment.cancel_reason}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl border border-line bg-surface p-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Amount</p>
              <p className="text-ink mt-0.5 tabular font-medium">{payment.amount.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Date</p>
              <p className="text-ink mt-0.5">{payment.payment_date}</p>
            </div>
            <div>
              <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Unallocated</p>
              <p className={`mt-0.5 tabular ${payment.unallocated_amount > 0 ? "text-warn font-medium" : "text-ink"}`}>{payment.unallocated_amount.toLocaleString()}</p>
            </div>
            {payment.method && (
              <div>
                <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Method</p>
                <p className="text-ink mt-0.5">{payment.method}</p>
              </div>
            )}
            {payment.reference_no && (
              <div>
                <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Reference #</p>
                <p className="text-ink mt-0.5">{payment.reference_no}</p>
              </div>
            )}
          </div>

          {payment.notes && <p className="text-sm text-ink-soft">Notes: {payment.notes}</p>}

          <div className="rounded-xl border border-line bg-surface overflow-hidden">
            <div className="px-4 py-2.5 border-b border-line">
              <h2 className="text-sm font-semibold text-ink">Allocations</h2>
            </div>
            <ul className="divide-y divide-line">
              {(allocations ?? []).map((a) => (
                <li key={a.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span className="font-mono text-xs text-ink">
                    {a.invoice_id ? invoiceNoById.get(a.invoice_id) : billNoById.get(a.supplier_bill_id!)}
                  </span>
                  <span className="tabular text-ink">{a.amount.toLocaleString()}</span>
                </li>
              ))}
              {!allocations?.length && <li className="px-4 py-4 text-center text-ink-faint text-xs">Koi allocation nahi hai — pura amount on-account hai.</li>}
            </ul>
          </div>

          {canManage && payment.status === "Posted" && payment.unallocated_amount > 0 && (
            <AllocatePaymentPanel paymentId={id} direction={payment.direction as "receipt" | "payment"} unallocatedAmount={payment.unallocated_amount} rows={allocRows} />
          )}
        </div>

        <div className="space-y-6">
          {canCancel && (
            <div className="rounded-xl border border-line bg-surface p-4">
              <h2 className="text-sm font-semibold text-ink mb-2">Actions</h2>
              <CancelPaymentButton paymentId={id} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
