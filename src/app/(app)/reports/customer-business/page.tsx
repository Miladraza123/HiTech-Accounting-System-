import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";

export default async function CustomerBusinessReportPage() {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "sales") || hasRole(user, "accounts") || hasRole(user, "auditor"))) redirect("/");

  const supabase = await createClient();
  const [{ data: parties }, { data: salesOrders }, { data: invoices }, { data: outstanding }] = await Promise.all([
    supabase.from("parties").select("id, legal_name").in("party_type", ["client", "both"]).order("legal_name"),
    supabase.from("sales_orders").select("id, party_id, grand_total, status, created_at").not("status", "eq", "Cancelled"),
    supabase.from("invoices").select("id, party_id, grand_total, status"),
    supabase.from("invoice_outstanding").select("party_id, outstanding_amount"),
  ]);

  const soByParty = new Map<string, { total: number; count: number; lastDate: string | null }>();
  for (const s of salesOrders ?? []) {
    const existing = soByParty.get(s.party_id) ?? { total: 0, count: 0, lastDate: null };
    existing.total += s.grand_total;
    existing.count += 1;
    if (!existing.lastDate || s.created_at > existing.lastDate) existing.lastDate = s.created_at;
    soByParty.set(s.party_id, existing);
  }

  const invoicedByParty = new Map<string, number>();
  for (const inv of invoices ?? []) {
    if (inv.status !== "Posted") continue;
    invoicedByParty.set(inv.party_id, (invoicedByParty.get(inv.party_id) ?? 0) + inv.grand_total);
  }

  const outstandingByParty = new Map<string, number>();
  for (const o of outstanding ?? []) {
    if (!o.party_id) continue;
    outstandingByParty.set(o.party_id, (outstandingByParty.get(o.party_id) ?? 0) + (o.outstanding_amount ?? 0));
  }

  const rows = (parties ?? [])
    .map((p) => {
      const so = soByParty.get(p.id) ?? { total: 0, count: 0, lastDate: null };
      return {
        id: p.id,
        name: p.legal_name,
        orderCount: so.count,
        orderValue: so.total,
        invoiced: invoicedByParty.get(p.id) ?? 0,
        outstanding: outstandingByParty.get(p.id) ?? 0,
        lastOrder: so.lastDate,
      };
    })
    .filter((r) => r.orderCount > 0)
    .sort((a, b) => b.orderValue - a.orderValue);

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
