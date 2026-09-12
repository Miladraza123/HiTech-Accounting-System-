import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { CancelSalesReturnButton } from "@/components/CancelSalesReturnButton";

const STATUS_STYLE: Record<string, string> = {
  Posted: "bg-good-soft text-good",
  Cancelled: "bg-bad-soft text-bad",
};

export default async function SalesReturnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const canManage = await hasPermission(user, "sales_return.manage");
  if (!(canManage || hasRole(user, "sales") || hasRole(user, "auditor"))) redirect("/");

  const supabase = await createClient();
  const [{ data: ret }, { data: lines }] = await Promise.all([
    supabase
      .from("sales_returns")
      .select("*, parties(legal_name), invoices(invoice_no), warehouses(name)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("sales_return_lines").select("*").eq("return_id", id).order("sort_order"),
  ]);

  if (!ret) notFound();

  const party = ret.parties as unknown as { legal_name: string } | null;
  const invoice = ret.invoices as unknown as { invoice_no: string } | null;
  const warehouse = ret.warehouses as unknown as { name: string } | null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href="/sales-returns" className="text-xs text-ink-faint hover:text-ink">
            ← Sales Returns
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-lg font-semibold text-ink font-mono">{ret.return_no}</h1>
            <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[ret.status] ?? ""}`}>{ret.status}</span>
          </div>
          <p className="text-sm text-ink-soft mt-0.5">
            {party?.legal_name} — Invoice{" "}
            <Link href={`/invoices/${ret.invoice_id}`} className="text-accent-ink underline underline-offset-2">
              {invoice?.invoice_no}
            </Link>
          </p>
        </div>
      </div>

      {ret.status === "Cancelled" && ret.cancel_reason && (
        <div className="rounded-md bg-bad-soft border border-bad px-4 py-2 text-sm text-bad">Cancellation reason: {ret.cancel_reason}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl border border-line bg-surface p-4 grid grid-cols-2 gap-4 text-sm">
            <Field label="Return Date" value={ret.return_date} />
            <Field label="Warehouse" value={warehouse?.name ?? "—"} />
            <Field label="Reason" value={ret.reason} />
          </div>

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
              <span className="text-ink-soft">Subtotal: {ret.subtotal}</span>
              <span className="text-ink-soft">Tax: {ret.tax_total}</span>
              <span className="font-semibold text-ink">Total: {ret.grand_total}</span>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {canManage && ret.status === "Posted" && (
            <div className="rounded-xl border border-line bg-surface p-4">
              <h2 className="text-sm font-semibold text-ink mb-2">Actions</h2>
              <CancelSalesReturnButton returnId={id} invoiceId={ret.invoice_id} />
            </div>
          )}
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
