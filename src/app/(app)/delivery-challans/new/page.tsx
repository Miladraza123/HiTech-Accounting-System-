import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fetchItemsByIds } from "@/lib/itemOptions";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { NewDeliveryChallanForm } from "@/components/NewDeliveryChallanForm";

// See /invoices/new: the whole eligible id set used to travel back to
// PostgREST inside the request URL, so a large enough backlog made the request
// unsendable and no delivery challan could be created. Fixed-size page now.
const PICKER_LIMIT = 50;

export default async function NewDeliveryChallanPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "delivery_challan.manage"))) redirect("/delivery-challans");

  const { q } = await searchParams;
  const term = (q ?? "").trim();

  const supabase = await createClient();
  // Which Sales Orders still have something left to deliver is a
  // column-vs-column test that PostgREST cannot express, so this page used to
  // fetch every open Sales Order with all of its lines and decide here.
  // fn_deliverable_sales_orders_page answers it in the database and returns
  // one page of the eligible set, newest first, plus the eligible total.
  const { data: eligibleIds } = await supabase.rpc("fn_deliverable_sales_orders_page", {
    p_search: term,
    p_limit: PICKER_LIMIT,
    p_offset: 0,
  });
  const ids = (eligibleIds ?? []).map((r) => r.id);
  const eligibleTotal = Number(eligibleIds?.[0]?.total_rows ?? 0);

  const [{ data: salesOrders }, { data: warehouses }] = await Promise.all([
    ids.length
      ? supabase
          .from("sales_orders")
          .select("*, parties(legal_name), sales_order_lines(*)")
          .in("id", ids)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    supabase.from("warehouses").select("*").eq("is_active", true).order("name"),
  ]);

  const eligible = salesOrders ?? [];

  // This screen has no item dropdown — it only needs each delivered line's
  // own item, to read its base unit. So look up exactly those, instead of
  // pulling the entire catalogue (every column of every item) to resolve a
  // handful of lines.
  const items = await fetchItemsByIds(
    supabase,
    eligible.flatMap((so) => (so.sales_order_lines ?? []).map((l: { item_id: string | null }) => l.item_id))
  );

  return (
    <div className="space-y-4">
      <div>
        <Link href="/delivery-challans" className="text-xs text-ink-faint hover:text-ink">
          ← Delivery Challans
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">New Delivery Challan</h1>
      </div>

      {/* The picker below is one page of the eligible set, not all of it —
          search reaches an older Sales Order without the request having to
          carry every eligible id. */}
      <form className="flex items-center gap-2 flex-wrap">
        <input
          type="search"
          name="q"
          defaultValue={term}
          placeholder="Search SO #, client PO # or client name"
          className="input !py-1.5 text-sm max-w-xs"
        />
        <button type="submit" className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition">
          Search
        </button>
        <span className="text-xs text-ink-faint">
          {eligibleTotal > eligible.length
            ? `Showing ${eligible.length} of ${eligibleTotal.toLocaleString()} eligible — search to narrow`
            : `${eligibleTotal.toLocaleString()} eligible`}
        </span>
      </form>

      {!eligible.length ? (
        <div className="rounded-xl border border-warn bg-warn-soft p-5 text-sm text-warn max-w-xl">
          {term
            ? `No eligible Sales Order matches "${term}". Clear the search to see the most recent eligible orders.`
            : "No Sales Order found with pending quantity for delivery."}{" "}
          <Link href="/sales-orders" className="underline underline-offset-2 font-medium">
            View Sales Orders
          </Link>
          .
        </div>
      ) : !warehouses?.length ? (
        <div className="rounded-xl border border-warn bg-warn-soft p-5 text-sm text-warn max-w-xl">
          At least one warehouse must exist first.{" "}
          <Link href="/setup/warehouses" className="underline underline-offset-2 font-medium">
            Add a warehouse
          </Link>
          .
        </div>
      ) : (
        <NewDeliveryChallanForm
          salesOrders={eligible.map((so) => ({
            id: so.id,
            so_no: so.so_no,
            business_line: so.business_line,
            parties: so.parties as unknown as { legal_name: string } | null,
            lines: (so.sales_order_lines as unknown as {
              id: string;
              description: string;
              ordered_qty: number;
              delivered_qty: number;
              unit: string | null;
              item_id: string | null;
            }[]).filter((l) => l.delivered_qty < l.ordered_qty),
          }))}
          warehouses={warehouses}
          items={items}
        />
      )}
    </div>
  );
}
