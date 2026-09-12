import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";

function daysOverdue(expected: string | null): number | null {
  if (!expected) return null;
  return Math.floor((Date.now() - new Date(expected).getTime()) / (1000 * 60 * 60 * 24));
}

export default async function PurchasePendingReportPage() {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "store") || hasRole(user, "accounts") || hasRole(user, "auditor"))) redirect("/");

  const supabase = await createClient();
  const { data: poLines } = await supabase
    .from("purchase_order_lines")
    .select("*, purchase_orders!inner(po_no, expected_delivery, status, parties(legal_name))")
    .not("purchase_orders.status", "in", "(Cancelled,Closed)")
    .order("purchase_order_id");

  type PoInfo = { po_no: string; expected_delivery: string | null; status: string; parties: { legal_name: string } | null };
  const rows = (poLines ?? [])
    .map((l) => {
      const po = l.purchase_orders as unknown as PoInfo;
      const pending = l.ordered_qty - l.received_qty;
      return {
        po_no: po.po_no,
        supplier: po.parties?.legal_name ?? "—",
        expected: po.expected_delivery,
        description: l.description,
        ordered: l.ordered_qty,
        received: l.received_qty,
        pending,
        unit: l.unit,
        overdueDays: daysOverdue(po.expected_delivery),
      };
    })
    .filter((r) => r.pending > 0.001)
    .sort((a, b) => (b.overdueDays ?? -9999) - (a.overdueDays ?? -9999));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/reports" className="text-xs text-ink-faint hover:text-ink">
          ← Reports
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">Purchase Pending Report</h1>
        <p className="text-sm text-ink-soft">Har Purchase Order line jahan receiving baki hai — sab se overdue pehle.</p>
      </div>

      <div className="rounded-xl border border-line bg-surface p-4 max-w-xs">
        <p className="text-2xl font-semibold text-ink tabular">{rows.length}</p>
        <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Pending Lines</p>
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-3 py-2">PO #</th>
                <th className="text-left px-3 py-2">Supplier</th>
                <th className="text-left px-3 py-2">Description</th>
                <th className="text-right px-3 py-2">Ordered</th>
                <th className="text-right px-3 py-2">Received</th>
                <th className="text-right px-3 py-2">Pending</th>
                <th className="text-left px-3 py-2">Expected</th>
                <th className="text-right px-3 py-2">Overdue (days)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="px-3 py-2 font-mono text-xs text-ink">{r.po_no}</td>
                  <td className="px-3 py-2 text-ink-soft">{r.supplier}</td>
                  <td className="px-3 py-2 text-ink">{r.description}</td>
                  <td className="px-3 py-2 text-right tabular text-ink-soft">
                    {r.ordered} {r.unit}
                  </td>
                  <td className="px-3 py-2 text-right tabular text-ink-soft">{r.received}</td>
                  <td className="px-3 py-2 text-right tabular text-warn font-medium">{r.pending.toFixed(3)}</td>
                  <td className="px-3 py-2 text-ink-faint text-xs">{r.expected ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular">
                    {r.overdueDays !== null && r.overdueDays > 0 ? (
                      <span className="text-bad font-medium">{r.overdueDays}</span>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-ink-faint">
                    Koi pending purchase nahi hai — sab receive ho chuka hai.
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
