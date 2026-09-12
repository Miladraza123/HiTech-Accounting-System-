import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { CancelSupplierBillButton } from "@/components/CancelSupplierBillButton";
import { PurchaseReturnPanel } from "@/components/PurchaseReturnPanel";
import { CancelPurchaseReturnButton } from "@/components/CancelPurchaseReturnButton";

const STATUS_STYLE: Record<string, string> = {
  Posted: "bg-good-soft text-good",
  Cancelled: "bg-bad-soft text-bad",
};

export default async function SupplierBillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const canManage = await hasPermission(user, "supplier_bill.manage");

  const supabase = await createClient();
  const [{ data: bill }, { data: lines }, { data: outstandingRow }, { data: allocations }, { data: warehouses }, { data: returns }] = await Promise.all([
    supabase
      .from("supplier_bills")
      .select("*, parties(legal_name, billing_address), grns(grn_no, received_date, warehouse_id)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("supplier_bill_lines").select("*, items(item_code, description)").eq("supplier_bill_id", id).order("sort_order"),
    supabase.from("supplier_bill_outstanding").select("*").eq("supplier_bill_id", id).maybeSingle(),
    supabase.from("payment_allocations").select("*, payments(payment_no, payment_date, status)").eq("supplier_bill_id", id).order("created_at", { ascending: false }),
    supabase.from("warehouses").select("*").eq("is_active", true).order("name"),
    supabase.from("purchase_returns").select("*").eq("supplier_bill_id", id).order("created_at", { ascending: false }),
  ]);

  if (!bill) notFound();

  const party = bill.parties as unknown as { legal_name: string; billing_address: string | null } | null;
  const grn = bill.grns as unknown as { grn_no: string; received_date: string; warehouse_id: string | null } | null;
  const outstanding = outstandingRow?.outstanding_amount ?? 0;
  const canCancel = canManage && bill.status === "Posted";
  const canReturn = (await hasPermission(user, "purchase_return.manage")) && bill.status === "Posted";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href="/supplier-bills" className="text-xs text-ink-faint hover:text-ink">
            ← Supplier Bills
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-lg font-semibold text-ink font-mono">{bill.bill_no}</h1>
            <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[bill.status] ?? ""}`}>{bill.status}</span>
          </div>
          <p className="text-sm text-ink-soft mt-0.5">
            {party?.legal_name} — GRN {grn?.grn_no} ({grn?.received_date})
          </p>
          {bill.supplier_bill_ref && <p className="text-xs text-ink-faint mt-0.5">Supplier Ref#: {bill.supplier_bill_ref}</p>}
        </div>
        <Link
          href={`/supplier-bills/${id}/print`}
          target="_blank"
          className="rounded-md border border-line-strong bg-bg px-3 py-2 text-xs text-ink hover:bg-surface-2 transition whitespace-nowrap"
        >
          Print / PDF
        </Link>
      </div>

      {bill.status === "Cancelled" && bill.cancel_reason && (
        <div className="rounded-md bg-bad-soft border border-bad px-4 py-2 text-sm text-bad">Cancel wajah: {bill.cancel_reason}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl border border-line bg-surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
                  <tr>
                    <th className="text-left px-3 py-2">Item</th>
                    <th className="text-right px-3 py-2">Qty</th>
                    <th className="text-right px-3 py-2">Rate</th>
                    <th className="text-right px-3 py-2">Tax %</th>
                    <th className="text-right px-3 py-2">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(lines ?? []).map((l) => {
                    const item = l.items as unknown as { item_code: string; description: string } | null;
                    return (
                      <tr key={l.id} className="border-t border-line">
                        <td className="px-3 py-2 text-ink">{item ? `${item.item_code} — ${item.description}` : l.description}</td>
                        <td className="px-3 py-2 text-right tabular text-ink-soft">{l.qty}</td>
                        <td className="px-3 py-2 text-right tabular text-ink-soft">{l.rate}</td>
                        <td className="px-3 py-2 text-right tabular text-ink-soft">{l.tax_pct}</td>
                        <td className="px-3 py-2 text-right tabular text-ink">{l.amount}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-6 border-t border-line px-4 py-3 text-sm tabular">
              <span className="text-ink-soft">Subtotal: {bill.subtotal}</span>
              <span className="text-ink-soft">Tax: {bill.tax_total}</span>
              <span className="font-semibold text-ink">Total: {bill.grand_total}</span>
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
              <h2 className="text-sm font-semibold text-ink">Purchase Returns</h2>
              <div className="rounded-xl border border-line bg-surface overflow-hidden divide-y divide-line">
                {returns.map((r) => (
                  <div key={r.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <div>
                      <Link href={`/purchase-returns/${r.id}`} className="text-accent-ink underline underline-offset-2 font-mono text-xs">
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

          {canReturn && (
            <PurchaseReturnPanel
              supplierBillId={id}
              defaultWarehouseId={grn?.warehouse_id ?? null}
              warehouses={warehouses ?? []}
              lines={(lines ?? []).map((l) => ({
                ...l,
                itemLabel: (l.items as unknown as { item_code: string; description: string } | null)
                  ? `${(l.items as unknown as { item_code: string; description: string }).item_code} — ${(l.items as unknown as { item_code: string; description: string }).description}`
                  : l.description,
              }))}
            />
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-line bg-surface p-4 space-y-2">
            <h2 className="text-sm font-semibold text-ink mb-1">Recovery</h2>
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-soft">Outstanding</span>
              <span className={`tabular font-semibold ${outstanding > 0 ? "text-warn" : "text-good"}`}>
                {bill.status === "Posted" ? outstanding.toLocaleString() : "—"}
              </span>
            </div>
            {bill.status === "Posted" && outstanding > 0 && canManage && (
              <Link href={`/payments/new?party=${bill.supplier_id}&direction=payment`} className="block text-center rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition">
                Payment Record Karen
              </Link>
            )}
          </div>

          {canCancel && (
            <div className="rounded-xl border border-line bg-surface p-4">
              <h2 className="text-sm font-semibold text-ink mb-2">Actions</h2>
              <CancelSupplierBillButton billId={id} />
            </div>
          )}

          {!!returns?.filter((r) => r.status === "Posted").length && canReturn && (
            <div className="rounded-xl border border-line bg-surface p-4 space-y-2">
              <h2 className="text-sm font-semibold text-ink mb-1">Purchase Return Actions</h2>
              {returns
                .filter((r) => r.status === "Posted")
                .map((r) => (
                  <div key={r.id} className="space-y-1">
                    <p className="text-xs text-ink-faint font-mono">{r.return_no}</p>
                    <CancelPurchaseReturnButton returnId={r.id} supplierBillId={id} />
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
