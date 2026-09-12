import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { parsePage, pageRange, totalPages as computeTotalPages } from "@/lib/pagination";
import { PaginationControls } from "@/components/PaginationControls";

const STATUS_STYLE: Record<string, string> = {
  Posted: "bg-good-soft text-good",
  Cancelled: "bg-bad-soft text-bad",
};

export default async function SupplierBillsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await getCurrentUser();
  const canCreate = await hasPermission(user, "supplier_bill.manage");
  const { page: pageParam } = await searchParams;
  const page = parsePage(pageParam);
  const [rangeFrom, rangeTo] = pageRange(page);

  const supabase = await createClient();
  const [{ data: bills, count }, { data: outstanding }] = await Promise.all([
    supabase
      .from("supplier_bills")
      .select("*, parties(legal_name), grns(grn_no)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(rangeFrom, rangeTo),
    supabase.from("supplier_bill_outstanding").select("*"),
  ]);
  const totalPages = computeTotalPages(count ?? 0);

  const outstandingById = new Map((outstanding ?? []).map((o) => [o.supplier_bill_id, o.outstanding_amount ?? 0]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink">Supplier Bills</h1>
          <p className="mt-1 text-sm text-ink-soft">GRN Clearing se Trade Payables mein book karna — &quot;stock&quot; type GRN ke liye.</p>
        </div>
        {canCreate && (
          <Link href="/supplier-bills/new" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition">
            + Nayi Supplier Bill
          </Link>
        )}
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-4 py-2.5">Bill #</th>
                <th className="text-left px-4 py-2.5">Supplier / GRN</th>
                <th className="text-right px-4 py-2.5">Total</th>
                <th className="text-right px-4 py-2.5">Outstanding</th>
                <th className="text-left px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {(bills ?? []).map((b) => {
                const party = b.parties as unknown as { legal_name: string } | null;
                const grn = b.grns as unknown as { grn_no: string } | null;
                const outstandingAmt = outstandingById.get(b.id) ?? 0;
                return (
                  <tr key={b.id} className="border-t border-line hover:bg-surface-2">
                    <td className="px-4 py-2.5">
                      <Link href={`/supplier-bills/${b.id}`} className="text-accent-ink underline underline-offset-2 font-mono text-xs">
                        {b.bill_no}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft text-xs whitespace-nowrap">
                      {party?.legal_name} <span className="text-ink-faint">({grn?.grn_no})</span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular text-ink">{b.grand_total.toLocaleString()}</td>
                    <td className={`px-4 py-2.5 text-right tabular ${outstandingAmt > 0 ? "text-warn font-medium" : "text-ink-soft"}`}>
                      {b.status === "Posted" ? outstandingAmt.toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[b.status] ?? ""}`}>{b.status}</span>
                    </td>
                  </tr>
                );
              })}
              {!bills?.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-ink-faint">
                    Koi Supplier Bill nahi hai abhi tak.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PaginationControls basePath="/supplier-bills" searchParams={{}} currentPage={page} totalPages={totalPages} />
    </div>
  );
}
