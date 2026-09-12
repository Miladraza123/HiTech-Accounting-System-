import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

export default async function PendingOrdersReportPage() {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "sales") || hasRole(user, "accounts") || hasRole(user, "auditor"))) redirect("/");

  const supabase = await createClient();
  const { data: soLines } = await supabase
    .from("sales_order_lines")
    .select("*, sales_orders!inner(so_no, client_po_number, po_date, status, parties(legal_name))")
    .not("sales_orders.status", "in", "(Cancelled,Closed)")
    .order("sales_order_id");

  type SoInfo = { so_no: string; client_po_number: string; po_date: string; status: string; parties: { legal_name: string } | null };
  const rows = (soLines ?? [])
    .map((l) => {
      const so = l.sales_orders as unknown as SoInfo;
      return {
        so_no: so.so_no,
        client_po_number: so.client_po_number,
        client: so.parties?.legal_name ?? "—",
        po_date: so.po_date,
        description: l.description,
        ordered: l.ordered_qty,
        delivered: l.delivered_qty,
        pendingDeliver: l.ordered_qty - l.delivered_qty,
        invoiced: l.invoiced_qty,
        pendingInvoice: l.delivered_qty - l.invoiced_qty,
        unit: l.unit,
        days: daysSince(so.po_date),
      };
    })
    .filter((r) => r.pendingDeliver > 0.001 || r.pendingInvoice > 0.001)
    .sort((a, b) => b.days - a.days);

  const totalPendingDeliverValue = rows.reduce((s, r) => s + r.pendingDeliver, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href="/reports" className="text-xs text-ink-faint hover:text-ink">
            ← Reports
          </Link>
          <h1 className="text-lg font-semibold text-ink mt-1">Pending Order &amp; Delivery Report</h1>
          <p className="text-sm text-ink-soft">Every Sales Order line with pending delivery or invoicing — oldest orders first.</p>
        </div>
        <a href="/reports/pending-orders/export" className="rounded-md border border-line-strong bg-bg px-3 py-2 text-xs text-ink hover:bg-surface-2 transition whitespace-nowrap">
          Export to Excel
        </a>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-2xl font-semibold text-ink tabular">{rows.length}</p>
          <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Pending Lines</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-2xl font-semibold text-ink tabular">{totalPendingDeliverValue.toFixed(2)}</p>
          <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Total Pending-to-Deliver Qty</p>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-3 py-2">SO #</th>
                <th className="text-left px-3 py-2">Client</th>
                <th className="text-left px-3 py-2">Description</th>
                <th className="text-right px-3 py-2">Ordered</th>
                <th className="text-right px-3 py-2">Pending Deliver</th>
                <th className="text-right px-3 py-2">Pending Invoice</th>
                <th className="text-right px-3 py-2">Days Since PO</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="px-3 py-2 font-mono text-xs text-ink">{r.so_no}</td>
                  <td className="px-3 py-2 text-ink-soft">{r.client}</td>
                  <td className="px-3 py-2 text-ink">{r.description}</td>
                  <td className="px-3 py-2 text-right tabular text-ink-soft">
                    {r.ordered} {r.unit}
                  </td>
                  <td className={`px-3 py-2 text-right tabular font-medium ${r.pendingDeliver > 0.001 ? "text-warn" : "text-ink-faint"}`}>
                    {r.pendingDeliver > 0.001 ? r.pendingDeliver.toFixed(3) : "—"}
                  </td>
                  <td className={`px-3 py-2 text-right tabular font-medium ${r.pendingInvoice > 0.001 ? "text-warn" : "text-ink-faint"}`}>
                    {r.pendingInvoice > 0.001 ? r.pendingInvoice.toFixed(3) : "—"}
                  </td>
                  <td className={`px-3 py-2 text-right tabular ${r.days > 30 ? "text-bad font-medium" : "text-ink-soft"}`}>{r.days}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-ink-faint">
                    No pending orders or deliveries — everything is up to date.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
