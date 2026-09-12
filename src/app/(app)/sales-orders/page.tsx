import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { computeHealth, HEALTH_LABEL_TEXT, HEALTH_BADGE_STYLE } from "@/lib/orderHealth";
import { toExclusiveUpperBound } from "@/lib/dashboardHelpers";
import { parsePage, pageRange, totalPages as computeTotalPages } from "@/lib/pagination";
import { PaginationControls } from "@/components/PaginationControls";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ShoppingCart } from "lucide-react";

const STATUS_TONE: Record<string, BadgeTone> = {
  Confirmed: "ledger",
  InProgress: "warn",
  PartiallyDelivered: "warn",
  Delivered: "good",
  Invoiced: "good",
  Closed: "neutral",
  Cancelled: "bad",
};

const BUSINESS_LINE_LABEL: Record<string, string> = {
  material_supply: "Material Supply",
  fabrication: "Fabrication",
};

export default async function SalesOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; page?: string }>;
}) {
  const { from, to, page: pageParam } = await searchParams;
  const page = parsePage(pageParam);
  const [rangeFrom, rangeTo] = pageRange(page);

  const supabase = await createClient();
  let query = supabase
    .from("sales_orders")
    .select("*, parties(legal_name)", { count: "exact" })
    .order("created_at", { ascending: false });
  if (from && to) query = query.gte("created_at", from).lt("created_at", toExclusiveUpperBound(to));
  const { data: orders, count } = await query.range(rangeFrom, rangeTo);
  const totalPages = computeTotalPages(count ?? 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Sales Orders</h1>
        <p className="mt-1 text-sm text-ink-soft">
          A Sales Order is created here from a Quotation once the Client PO is confirmed.
          {from && to && (
            <>
              {" "}
              — from <span className="text-ink">{from}</span> to <span className="text-ink">{to}</span>{" "}
              <Link href="/sales-orders" className="text-accent-ink underline underline-offset-2">
                (view all)
              </Link>
            </>
          )}
        </p>
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        {orders?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="text-left px-4 py-2.5">SO #</th>
                  <th className="text-left px-4 py-2.5">Client</th>
                  <th className="text-left px-4 py-2.5">Client PO #</th>
                  <th className="text-left px-4 py-2.5">Line</th>
                  <th className="text-right px-4 py-2.5">Total</th>
                  <th className="text-left px-4 py-2.5">Status</th>
                  <th className="text-left px-4 py-2.5">Health</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((so) => {
                  const health = computeHealth({
                    isOpen: !["Delivered", "Invoiced", "Closed", "Cancelled"].includes(so.status),
                    promisedDate: so.delivery_schedule,
                    updatedAt: so.updated_at,
                  });
                  return (
                    <tr key={so.id} className="border-t border-line even:bg-bg hover:bg-surface-2">
                      <td className="px-4 py-2.5">
                        <Link href={`/sales-orders/${so.id}`} className="text-accent-ink underline underline-offset-2 font-mono text-xs">
                          {so.so_no}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-ink whitespace-nowrap">{(so.parties as unknown as { legal_name: string } | null)?.legal_name ?? "—"}</td>
                      <td className="px-4 py-2.5 text-ink-soft font-mono text-xs whitespace-nowrap">{so.client_po_number}</td>
                      <td className="px-4 py-2.5 text-ink-soft text-xs whitespace-nowrap">{BUSINESS_LINE_LABEL[so.business_line]}</td>
                      <td className="px-4 py-2.5 text-right tabular text-ink">{so.grand_total}</td>
                      <td className="px-4 py-2.5">
                        <Badge tone={STATUS_TONE[so.status] ?? "neutral"}>{so.status}</Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        {health && (
                          <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${HEALTH_BADGE_STYLE[health.label]}`} title={health.reason}>
                            {HEALTH_LABEL_TEXT[health.label]}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<ShoppingCart size={22} />}
            title="No Sales Orders yet"
            description="A Sales Order is created here from a Quotation once the Client's PO is confirmed."
          />
        )}
      </div>

      <PaginationControls basePath="/sales-orders" searchParams={{ from, to }} currentPage={page} totalPages={totalPages} totalCount={count ?? 0} />
    </div>
  );
}
