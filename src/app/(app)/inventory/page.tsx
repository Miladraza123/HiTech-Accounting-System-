import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { parsePage, pageRange, totalPages as computeTotalPages } from "@/lib/pagination";
import { PaginationControls } from "@/components/PaginationControls";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ warehouse?: string; page?: string }>;
}) {
  const user = await getCurrentUser();
  const canRequest = await hasPermission(user, "inventory_adjustment.request");
  const { warehouse: warehouseFilter, page: pageParam } = await searchParams;
  const page = parsePage(pageParam);
  const [rangeFrom, rangeTo] = pageRange(page);

  const supabase = await createClient();

  // Summary cards (combo count / total value / reserved combos) are
  // computed by the DB via fn_inventory_summary — a single aggregate
  // query over `current_stock`/`reserved_stock` — instead of pulling
  // every stock row into the app and reducing in JS. `current_stock`
  // resolves over `stock_ledger`, the transactional ledger that grows
  // with every GRN/Delivery/Adjustment/Transfer, so shipping the whole
  // thing to the app on every page view would get slower forever as
  // real data accumulates; the aggregate always returns exactly 3 numbers.
  let stockQuery = supabase.from("current_stock").select("*", { count: "exact" }).neq("qty_on_hand", 0).order("item_id").range(rangeFrom, rangeTo);
  if (warehouseFilter) stockQuery = stockQuery.eq("warehouse_id", warehouseFilter);

  const [{ data: summary }, { data: stock, count }, { data: warehouses }, { count: pendingCount }] = await Promise.all([
    supabase.rpc("fn_inventory_summary", { p_warehouse_id: warehouseFilter || undefined }).maybeSingle(),
    stockQuery,
    supabase.from("warehouses").select("id, name"),
    supabase.from("stock_adjustments").select("id", { count: "exact", head: true }).eq("status", "Pending"),
  ]);

  const rows = stock ?? [];
  const totalPages = computeTotalPages(count ?? 0);
  // Only look up names/availability for the item×warehouse combos on this
  // page, not the whole catalog — same reasoning as the summary query.
  const pageItemIds = [...new Set(rows.map((r) => r.item_id!))];
  const pageWarehouseIds = [...new Set(rows.map((r) => r.warehouse_id!))];
  const [{ data: items }, { data: availability }] = await Promise.all([
    pageItemIds.length
      ? supabase.from("items").select("id, item_code, description, base_unit").in("id", pageItemIds)
      : Promise.resolve({ data: [] as { id: string; item_code: string; description: string; base_unit: string }[] }),
    pageItemIds.length
      ? supabase.from("stock_availability").select("*").in("item_id", pageItemIds).in("warehouse_id", pageWarehouseIds)
      : Promise.resolve({ data: [] as { item_id: string | null; warehouse_id: string | null; reserved_qty: number | null; free_qty: number | null }[] }),
  ]);

  const itemById = new Map((items ?? []).map((i) => [i.id, i]));
  const whById = new Map((warehouses ?? []).map((w) => [w.id, w]));
  const availabilityByKey = new Map((availability ?? []).map((a) => [`${a.item_id}-${a.warehouse_id}`, a]));
  const totalValue = summary?.total_value ?? 0;
  const reservedCombos = summary?.reserved_combos ?? 0;
  const comboCount = summary?.combo_count ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Inventory</h1>
          <p className="mt-1 text-sm text-ink-soft">Current stock — updated live from GRN, Issue, Return, Adjustment.</p>
        </div>
        {canRequest && (
          <Link href="/inventory/adjustments" className="rounded-md border border-line-strong bg-bg px-3 py-2 text-xs text-ink hover:bg-surface-2 transition">
            Stock Adjustments {pendingCount ? `(${pendingCount} pending)` : ""}
          </Link>
        )}
      </div>

      <form className="flex items-center gap-2 flex-wrap">
        <select name="warehouse" defaultValue={warehouseFilter ?? ""} className="input !py-1.5 text-sm max-w-xs">
          <option value="">— All Warehouses —</option>
          {(warehouses ?? []).map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition">
          Filter
        </button>
      </form>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-2xl font-semibold text-ink tabular">{comboCount}</p>
          <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Item × Warehouse combos in stock</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-2xl font-semibold text-ink tabular">{totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
          <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Total inventory value (PKR)</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-2xl font-semibold text-ink tabular">{reservedCombos}</p>
          <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Combos with active Job reservation</p>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-4 py-2.5">Item</th>
                <th className="text-left px-4 py-2.5">Warehouse</th>
                <th className="text-right px-4 py-2.5">On Hand</th>
                <th className="text-right px-4 py-2.5">Reserved</th>
                <th className="text-right px-4 py-2.5">Free</th>
                <th className="text-right px-4 py-2.5">Avg Cost</th>
                <th className="text-right px-4 py-2.5">Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const item = itemById.get(r.item_id!);
                const avail = availabilityByKey.get(`${r.item_id}-${r.warehouse_id}`);
                const reserved = avail?.reserved_qty ?? 0;
                return (
                  <tr key={`${r.item_id}-${r.warehouse_id}`} className="border-t border-line hover:bg-surface-2">
                    <td className="px-4 py-2.5">
                      <Link href={`/inventory/${r.item_id}/${r.warehouse_id}`} className="text-accent-ink underline underline-offset-2">
                        {item?.item_code} — {item?.description}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft whitespace-nowrap">{whById.get(r.warehouse_id!)?.name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular text-ink">
                      {r.qty_on_hand} {item?.base_unit}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular text-ink-soft">{reserved > 0 ? reserved : "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular text-ink font-medium">{avail?.free_qty ?? r.qty_on_hand}</td>
                    <td className="px-4 py-2.5 text-right tabular text-ink-soft">{r.avg_cost}</td>
                    <td className="px-4 py-2.5 text-right tabular text-ink">{r.stock_value?.toLocaleString()}</td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-ink-faint">
                    No stock yet — it will appear here once a GRN is received.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PaginationControls
        basePath="/inventory"
        searchParams={{ warehouse: warehouseFilter }}
        currentPage={page}
        totalPages={totalPages}
        totalCount={count ?? 0}
      />
    </div>
  );
}
