import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { parsePage, pageRange, totalPages as computeTotalPages, DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { PaginationControls } from "@/components/PaginationControls";

export default async function PurchasePendingReportPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "store") || hasRole(user, "accounts") || hasRole(user, "auditor"))) redirect("/");

  const { page: pageParam } = await searchParams;
  const page = parsePage(pageParam);
  const [rangeFrom] = pageRange(page);

  const supabase = await createClient();
  // Same change as the Pending Orders report: every line of every open PO
  // used to be fetched so the fully-received ones could be dropped here.
  // fn_purchase_pending filters in SQL and returns a single page. Sorting by
  // overdue-days descending with nulls last is exactly expected_delivery
  // ascending nulls last, so the order is unchanged.
  const { data: pending } = await supabase.rpc("fn_purchase_pending", {
    p_limit: DEFAULT_PAGE_SIZE,
    p_offset: rangeFrom,
  });

  const rows = (pending ?? []).map((r) => ({
    po_no: r.po_no,
    supplier: r.supplier,
    expected: r.expected,
    description: r.description,
    ordered: r.ordered,
    received: r.received,
    pending: r.pending,
    unit: r.unit,
    overdueDays: r.overdue_days,
  }));

  const totalRows = pending?.[0]?.total_rows ?? 0;
  const totalPages = computeTotalPages(totalRows);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/reports" className="text-xs text-ink-faint hover:text-ink">
          ← Reports
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">Purchase Pending Report</h1>
        <p className="text-sm text-ink-soft">Every Purchase Order line with pending receiving — most overdue first.</p>
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
                    No pending purchases — everything has been received.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PaginationControls basePath="/reports/purchase-pending" searchParams={{}} currentPage={page} totalPages={totalPages} totalCount={totalRows} />
    </div>
  );
}
