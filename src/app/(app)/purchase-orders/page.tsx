import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { computeHealth, HEALTH_LABEL_TEXT, HEALTH_BADGE_STYLE } from "@/lib/orderHealth";
import { parsePage, pageRange, totalPages as computeTotalPages } from "@/lib/pagination";
import { PaginationControls } from "@/components/PaginationControls";
import { buttonClass } from "@/components/ui/Button";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Truck } from "lucide-react";

const STATUS_TONE: Record<string, BadgeTone> = {
  Confirmed: "ledger",
  PartiallyReceived: "warn",
  Received: "good",
  Closed: "neutral",
  Cancelled: "bad",
};

const TYPE_LABEL: Record<string, string> = { direct: "Direct", stock: "Stock", general: "General" };

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string; page?: string }>;
}) {
  const user = await getCurrentUser();
  const canCreate = await hasPermission(user, "purchase_order.manage");
  const { open, page: pageParam } = await searchParams;
  const page = parsePage(pageParam);
  const [rangeFrom, rangeTo] = pageRange(page);

  const supabase = await createClient();
  let query = supabase
    .from("purchase_orders")
    .select("*, parties(legal_name)", { count: "exact" })
    .order("created_at", { ascending: false });
  if (open === "1") query = query.not("status", "in", "(Received,Closed,Cancelled)");
  const { data: orders, count } = await query.range(rangeFrom, rangeTo);
  const totalPages = computeTotalPages(count ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink">Purchase Orders</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Supplier se khareed — client order (direct), warehouse stock, ya general.
            {open === "1" && (
              <>
                {" "}
                — sirf open POs{" "}
                <Link href="/purchase-orders" className="text-accent-ink underline underline-offset-2">
                  (sab dekhen)
                </Link>
              </>
            )}
          </p>
        </div>
        {canCreate && (
          <Link href="/purchase-orders/new" className={buttonClass()}>
            + New Purchase Order
          </Link>
        )}
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        {orders?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="text-left px-4 py-2.5">PO #</th>
                  <th className="text-left px-4 py-2.5">Supplier</th>
                  <th className="text-left px-4 py-2.5">Type</th>
                  <th className="text-right px-4 py-2.5">Total</th>
                  <th className="text-left px-4 py-2.5">Status</th>
                  <th className="text-left px-4 py-2.5">Health</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((po) => {
                  const health = computeHealth({
                    isOpen: !["Received", "Closed", "Cancelled"].includes(po.status),
                    promisedDate: po.expected_delivery,
                    updatedAt: po.updated_at,
                  });
                  return (
                    <tr key={po.id} className="border-t border-line even:bg-bg hover:bg-surface-2">
                      <td className="px-4 py-2.5">
                        <Link href={`/purchase-orders/${po.id}`} className="text-accent-ink underline underline-offset-2 font-mono text-xs">
                          {po.po_no}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-ink whitespace-nowrap">{(po.parties as unknown as { legal_name: string } | null)?.legal_name ?? "—"}</td>
                      <td className="px-4 py-2.5 text-ink-soft text-xs">{TYPE_LABEL[po.purchase_type]}</td>
                      <td className="px-4 py-2.5 text-right tabular text-ink">{po.grand_total}</td>
                      <td className="px-4 py-2.5">
                        <Badge tone={STATUS_TONE[po.status] ?? "neutral"}>{po.status}</Badge>
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
            icon={<Truck size={22} />}
            title="Koi Purchase Order nahi hai abhi tak"
            description="Supplier se khareed — client order (direct), warehouse stock, ya general."
            action={
              canCreate ? (
                <Link href="/purchase-orders/new" className={buttonClass()}>
                  + New Purchase Order
                </Link>
              ) : undefined
            }
          />
        )}
      </div>

      <PaginationControls basePath="/purchase-orders" searchParams={{ open }} currentPage={page} totalPages={totalPages} totalCount={count ?? 0} />
    </div>
  );
}
