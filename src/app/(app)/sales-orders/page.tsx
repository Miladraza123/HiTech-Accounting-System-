import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

const STATUS_STYLE: Record<string, string> = {
  Confirmed: "bg-ledger-soft text-ledger",
  InProgress: "bg-warn-soft text-warn",
  PartiallyDelivered: "bg-warn-soft text-warn",
  Delivered: "bg-good-soft text-good",
  Invoiced: "bg-good-soft text-good",
  Closed: "bg-surface-2 text-ink-faint",
  Cancelled: "bg-bad-soft text-bad",
};

const BUSINESS_LINE_LABEL: Record<string, string> = {
  material_supply: "Material Supply",
  fabrication: "Fabrication",
};

export default async function SalesOrdersPage() {
  const supabase = await createClient();
  const { data: orders } = await supabase
    .from("sales_orders")
    .select("*, parties(legal_name)")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Sales Orders</h1>
        <p className="mt-1 text-sm text-ink-soft">Client PO confirm hone ke baad Quotation se yahan Sales Order banti hai.</p>
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
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
              </tr>
            </thead>
            <tbody>
              {(orders ?? []).map((so) => (
                <tr key={so.id} className="border-t border-line hover:bg-surface-2">
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
                    <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[so.status] ?? ""}`}>{so.status}</span>
                  </td>
                </tr>
              ))}
              {!orders?.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-ink-faint">
                    Koi Sales Order nahi hai abhi tak.
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
