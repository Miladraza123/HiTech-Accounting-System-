import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { NewDeliveryChallanForm } from "@/components/NewDeliveryChallanForm";

export default async function NewDeliveryChallanPage() {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "delivery_challan.manage"))) redirect("/delivery-challans");

  const supabase = await createClient();
  // Which Sales Orders still have something left to deliver is a
  // column-vs-column test that PostgREST cannot express, so this page used to
  // fetch every open Sales Order with all of its lines and decide here.
  // fn_deliverable_sales_order_ids answers it in the database; only those
  // orders are fetched. The eligible set shrinks as orders are delivered.
  const { data: eligibleIds } = await supabase.rpc("fn_deliverable_sales_order_ids");
  const ids = (eligibleIds ?? []).map((r) => r.id);

  const [{ data: salesOrders }, { data: warehouses }, { data: items }, { data: altUnits }] = await Promise.all([
    ids.length
      ? supabase
          .from("sales_orders")
          .select("*, parties(legal_name), sales_order_lines(*)")
          .in("id", ids)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    supabase.from("warehouses").select("*").eq("is_active", true).order("name"),
    supabase.from("items").select("*"),
    supabase.from("item_alt_units").select("*").eq("is_active", true),
  ]);

  const eligible = salesOrders ?? [];

  return (
    <div className="space-y-4">
      <div>
        <Link href="/delivery-challans" className="text-xs text-ink-faint hover:text-ink">
          ← Delivery Challans
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">New Delivery Challan</h1>
      </div>

      {!eligible.length ? (
        <div className="rounded-xl border border-warn bg-warn-soft p-5 text-sm text-warn max-w-xl">
          No Sales Order found with pending quantity for delivery.{" "}
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
          items={items ?? []}
          altUnits={altUnits ?? []}
        />
      )}
    </div>
  );
}
