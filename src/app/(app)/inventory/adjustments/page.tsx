import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { StockAdjustmentRequestForm } from "@/components/StockAdjustmentRequestForm";
import { AdjustmentDecisionButtons } from "@/components/AdjustmentDecisionButtons";
import { parsePage, pageRange, totalPages as computeTotalPages } from "@/lib/pagination";
import { PaginationControls } from "@/components/PaginationControls";

const STATUS_STYLE: Record<string, string> = {
  Pending: "bg-warn-soft text-warn",
  Approved: "bg-good-soft text-good",
  Rejected: "bg-bad-soft text-bad",
};

export default async function StockAdjustmentsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await getCurrentUser();
  const canRequest = await hasPermission(user, "inventory_adjustment.request");
  if (!canRequest) redirect("/inventory");

  const { page: pageParam } = await searchParams;
  const page = parsePage(pageParam);
  const [rangeFrom, rangeTo] = pageRange(page);

  const supabase = await createClient();
  // The adjustment history is paginated; the items/warehouses lists stay full
  // because StockAdjustmentRequestForm's dropdowns need every option. Those
  // dropdowns are handled separately (searchable server-side pickers).
  const [{ data: adjustments, count }, { data: items }, { data: warehouses }, { data: profiles }] = await Promise.all([
    supabase.from("stock_adjustments").select("*", { count: "exact" }).order("requested_at", { ascending: false }).range(rangeFrom, rangeTo),
    supabase.from("items").select("*").eq("is_active", true).order("item_code"),
    supabase.from("warehouses").select("*").eq("is_active", true).order("name"),
    supabase.from("profiles").select("id, full_name"),
  ]);
  const totalPages = computeTotalPages(count ?? 0);

  const itemById = new Map((items ?? []).map((i) => [i.id, i]));
  const whById = new Map((warehouses ?? []).map((w) => [w.id, w]));
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/inventory" className="text-xs text-ink-faint hover:text-ink">
          ← Inventory
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">Stock Adjustments</h1>
        <p className="mt-1 text-sm text-ink-soft">Physical count discrepancies — stock and books don&apos;t change without Owner approval.</p>
      </div>

      <StockAdjustmentRequestForm items={items ?? []} warehouses={warehouses ?? []} />

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-4 py-2.5">Item</th>
                <th className="text-left px-4 py-2.5">Warehouse</th>
                <th className="text-right px-4 py-2.5">Qty Delta</th>
                <th className="text-left px-4 py-2.5">Reason</th>
                <th className="text-left px-4 py-2.5">Requested By</th>
                <th className="text-left px-4 py-2.5">Status</th>
                {isOwner(user) && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {(adjustments ?? []).map((a) => (
                <tr key={a.id} className="border-t border-line">
                  <td className="px-4 py-2.5 text-ink whitespace-nowrap">{itemById.get(a.item_id)?.item_code ?? "—"}</td>
                  <td className="px-4 py-2.5 text-ink-soft whitespace-nowrap">{whById.get(a.warehouse_id)?.name ?? "—"}</td>
                  <td className={`px-4 py-2.5 text-right tabular ${a.qty_delta < 0 ? "text-bad" : "text-good"}`}>
                    {a.qty_delta > 0 ? `+${a.qty_delta}` : a.qty_delta}
                  </td>
                  <td className="px-4 py-2.5 text-ink-soft max-w-xs truncate">{a.reason}</td>
                  <td className="px-4 py-2.5 text-ink-soft text-xs whitespace-nowrap">{(a.requested_by && nameById.get(a.requested_by)) || "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[a.status] ?? ""}`}>{a.status}</span>
                  </td>
                  {isOwner(user) && (
                    <td className="px-4 py-2.5">{a.status === "Pending" && <AdjustmentDecisionButtons adjustmentId={a.id} />}</td>
                  )}
                </tr>
              ))}
              {!adjustments?.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-ink-faint">
                    No adjustment requests found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PaginationControls
        basePath="/inventory/adjustments"
        searchParams={{}}
        currentPage={page}
        totalPages={totalPages}
        totalCount={count ?? 0}
      />
    </div>
  );
}
