import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { parsePage, pageRange, totalPages as computeTotalPages } from "@/lib/pagination";
import { PaginationControls } from "@/components/PaginationControls";

// Mirrors the Sales Order detail page's own status badge styling exactly —
// this report shows the same sales_orders.status a Sales Order already
// carries, not a separately derived label.
const STATUS_STYLE: Record<string, string> = {
  Confirmed: "bg-ledger-soft text-ledger",
  InProgress: "bg-warn-soft text-warn",
  PartiallyDelivered: "bg-warn-soft text-warn",
  Delivered: "bg-good-soft text-good",
  Invoiced: "bg-good-soft text-good",
  Closed: "bg-surface-2 text-ink-faint",
  Cancelled: "bg-bad-soft text-bad",
};

// "Pending" = not yet invoiced (still owed to the client in some form,
// whether that's production, delivery, or billing) — matches how every
// other pending-work report in this app defines "pending".
const DONE_STATUSES = ["Invoiced", "Closed", "Cancelled"];

export default async function CompanyOrdersReportPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; filter?: string }>;
}) {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "sales") || hasRole(user, "accounts") || hasRole(user, "auditor"))) redirect("/");

  const { page: pageParam, filter: filterParam } = await searchParams;
  const filter = filterParam === "all" ? "all" : "pending";
  const page = parsePage(pageParam);
  const [rangeFrom, rangeTo] = pageRange(page);

  const supabase = await createClient();
  let query = supabase
    .from("sales_orders")
    .select("id, so_no, status, client_po_number, grand_total, created_at, parties(legal_name)", { count: "exact" });
  if (filter === "pending") query = query.not("status", "in", `(${DONE_STATUSES.join(",")})`);

  const { data: orders, count } = await query
    .order("legal_name", { referencedTable: "parties" })
    .order("so_no")
    .range(rangeFrom, rangeTo);
  const totalPages = computeTotalPages(count ?? 0);

  type Row = { id: string; so_no: string; status: string; client_po_number: string; grand_total: number; created_at: string; company: string };
  const rows: Row[] = (orders ?? []).map((o) => ({
    id: o.id,
    so_no: o.so_no,
    status: o.status,
    client_po_number: o.client_po_number,
    grand_total: o.grand_total,
    created_at: o.created_at,
    company: (o.parties as unknown as { legal_name: string } | null)?.legal_name ?? "—",
  }));

  // Group consecutive rows under the same company into one heading — rows
  // already arrive sorted by company name, so a run of the same name on
  // this page is always contiguous.
  const groups: { company: string; rows: Row[] }[] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.company === r.company) last.rows.push(r);
    else groups.push({ company: r.company, rows: [r] });
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/reports" className="text-xs text-ink-faint hover:text-ink">
          ← Reports
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">Company-wise Order List</h1>
        <p className="text-sm text-ink-soft">Every Sales Order, grouped under its Company — status shows where each one currently stands.</p>
      </div>

      <div className="flex gap-2 text-xs">
        <Link
          href="/reports/company-orders?filter=pending"
          className={`rounded-md px-3 py-1.5 border transition ${filter === "pending" ? "border-accent bg-accent-soft/40 text-ink font-medium" : "border-line bg-bg text-ink-soft hover:bg-surface-2"}`}
        >
          Pending only
        </Link>
        <Link
          href="/reports/company-orders?filter=all"
          className={`rounded-md px-3 py-1.5 border transition ${filter === "all" ? "border-accent bg-accent-soft/40 text-ink font-medium" : "border-line bg-bg text-ink-soft hover:bg-surface-2"}`}
        >
          All
        </Link>
      </div>

      <div className="space-y-5">
        {groups.map((g) => (
          <div key={g.company} className="rounded-xl border border-line bg-surface overflow-hidden">
            <div className="flex items-center justify-between bg-surface-2 px-4 py-2">
              <h2 className="text-sm font-semibold text-ink">{g.company}</h2>
              <span className="text-xs font-mono text-ink-faint">{g.rows.length} order{g.rows.length === 1 ? "" : "s"} on this page</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs font-mono uppercase tracking-wide text-ink-faint">
                  <tr>
                    <th className="text-left px-3 py-2">SO #</th>
                    <th className="text-left px-3 py-2">Client PO #</th>
                    <th className="text-left px-3 py-2">Date</th>
                    <th className="text-right px-3 py-2">Total</th>
                    <th className="text-left px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.id} className="border-t border-line">
                      <td className="px-3 py-2">
                        <Link href={`/sales-orders/${r.id}`} className="text-accent-ink underline underline-offset-2">
                          {r.so_no}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-ink-soft">{r.client_po_number}</td>
                      <td className="px-3 py-2 text-ink-faint text-xs">{new Date(r.created_at).toLocaleDateString("en-PK")}</td>
                      <td className="px-3 py-2 text-right tabular text-ink">{r.grand_total.toLocaleString()}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-mono whitespace-nowrap ${STATUS_STYLE[r.status] ?? ""}`}>{r.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        {!rows.length && (
          <div className="rounded-xl border border-line bg-surface p-6 text-center text-sm text-ink-faint">
            {filter === "pending" ? "No pending orders — everything is invoiced, closed, or cancelled." : "No orders found."}
          </div>
        )}
      </div>

      <PaginationControls basePath="/reports/company-orders" searchParams={{ filter }} currentPage={page} totalPages={totalPages} totalCount={count ?? 0} />
    </div>
  );
}
