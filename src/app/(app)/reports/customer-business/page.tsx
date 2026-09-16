import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";

export default async function CustomerBusinessReportPage() {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "sales") || hasRole(user, "accounts") || hasRole(user, "auditor"))) redirect("/");

  const supabase = await createClient();
  // Was: fetch every non-cancelled sales order, every invoice and every
  // invoice_outstanding row, then group them per client here. The rendered
  // result is one row per client — bounded by the customer list — but three
  // of those four inputs grow with every transaction the business makes.
  // fn_customer_business does the grouping in the database.
  const { data: business } = await supabase.rpc("fn_customer_business");

  const rows = (business ?? []).map((r) => ({
    id: r.party_id,
    name: r.name,
    orderCount: r.order_count,
    orderValue: r.order_value,
    invoiced: r.invoiced,
    outstanding: r.outstanding,
    lastOrder: r.last_order_date,
  }));

  const grandTotalOrders = rows.reduce((s, r) => s + r.orderValue, 0);
  const grandTotalOutstanding = rows.reduce((s, r) => s + r.outstanding, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href="/reports" className="text-xs text-ink-faint hover:text-ink">
            ← Reports
          </Link>
          <h1 className="text-lg font-semibold text-ink mt-1">Customer-wise Business Report</h1>
          <p className="text-sm text-ink-soft">Total order value, invoiced amount, and outstanding for each client — largest client first.</p>
        </div>
        <a href="/reports/customer-business/export" className="rounded-md border border-line-strong bg-bg px-3 py-2 text-xs text-ink hover:bg-surface-2 transition whitespace-nowrap">
          Export to Excel
        </a>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-2xl font-semibold text-ink tabular">{rows.length}</p>
          <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Active Clients</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-2xl font-semibold text-ink tabular">{grandTotalOrders.toLocaleString()}</p>
          <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Total Order Value</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className={`text-2xl font-semibold tabular ${grandTotalOutstanding > 0 ? "text-warn" : "text-ink"}`}>{grandTotalOutstanding.toLocaleString()}</p>
          <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Total Outstanding</p>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-3 py-2">Client</th>
                <th className="text-right px-3 py-2"># Orders</th>
                <th className="text-right px-3 py-2">Order Value</th>
                <th className="text-right px-3 py-2">Invoiced</th>
                <th className="text-right px-3 py-2">Outstanding</th>
                <th className="text-left px-3 py-2">Last Order</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-3 py-2 text-ink">
                    <Link href={`/clients/${r.id}`} className="text-accent-ink underline underline-offset-2">
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular text-ink-soft">{r.orderCount}</td>
                  <td className="px-3 py-2 text-right tabular text-ink font-medium">{r.orderValue.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular text-ink-soft">{r.invoiced.toLocaleString()}</td>
                  <td className={`px-3 py-2 text-right tabular ${r.outstanding > 0 ? "text-warn font-medium" : "text-ink-faint"}`}>
                    {r.outstanding.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-ink-faint text-xs">{r.lastOrder ? new Date(r.lastOrder).toLocaleDateString("en-PK") : "—"}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-ink-faint">
                    No client business data found.
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
