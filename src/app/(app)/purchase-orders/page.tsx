import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";

const STATUS_STYLE: Record<string, string> = {
  Confirmed: "bg-ledger-soft text-ledger",
  PartiallyReceived: "bg-warn-soft text-warn",
  Received: "bg-good-soft text-good",
  Closed: "bg-surface-2 text-ink-faint",
  Cancelled: "bg-bad-soft text-bad",
};

const TYPE_LABEL: Record<string, string> = { direct: "Direct", stock: "Stock", general: "General" };

export default async function PurchaseOrdersPage() {
  const user = await getCurrentUser();
  const canCreate = isOwner(user) || hasRole(user, "store");

  const supabase = await createClient();
  const { data: orders } = await supabase
    .from("purchase_orders")
    .select("*, parties(legal_name)")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink">Purchase Orders</h1>
          <p className="mt-1 text-sm text-ink-soft">Supplier se khareed — client order (direct), warehouse stock, ya general.</p>
        </div>
        {canCreate && (
          <Link href="/purchase-orders/new" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition">
            + Nayi Purchase Order
          </Link>
        )}
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-4 py-2.5">PO #</th>
                <th className="text-left px-4 py-2.5">Supplier</th>
                <th className="text-left px-4 py-2.5">Type</th>
                <th className="text-right px-4 py-2.5">Total</th>
                <th className="text-left px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {(orders ?? []).map((po) => (
                <tr key={po.id} className="border-t border-line hover:bg-surface-2">
                  <td className="px-4 py-2.5">
                    <Link href={`/purchase-orders/${po.id}`} className="text-accent-ink underline underline-offset-2 font-mono text-xs">
                      {po.po_no}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-ink whitespace-nowrap">{(po.parties as unknown as { legal_name: string } | null)?.legal_name ?? "—"}</td>
                  <td className="px-4 py-2.5 text-ink-soft text-xs">{TYPE_LABEL[po.purchase_type]}</td>
                  <td className="px-4 py-2.5 text-right tabular text-ink">{po.grand_total}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[po.status] ?? ""}`}>{po.status}</span>
                  </td>
                </tr>
              ))}
              {!orders?.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-ink-faint">
                    Koi Purchase Order nahi hai abhi tak.
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
