import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { NewDeliveryChallanForm } from "@/components/NewDeliveryChallanForm";

export default async function NewDeliveryChallanPage() {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "dispatch"))) redirect("/delivery-challans");

  const supabase = await createClient();
  const [{ data: salesOrders }, { data: warehouses }, { data: items }, { data: altUnits }] = await Promise.all([
    supabase
      .from("sales_orders")
      .select("*, parties(legal_name), sales_order_lines(*)")
      .not("status", "in", "(Cancelled,Closed)")
      .order("created_at", { ascending: false }),
    supabase.from("warehouses").select("*").eq("is_active", true).order("name"),
    supabase.from("items").select("*"),
    supabase.from("item_alt_units").select("*").eq("is_active", true),
  ]);

  // Only Sales Orders that actually have something left to deliver
  const eligible = (salesOrders ?? []).filter((so) => {
    const lines = so.sales_order_lines as unknown as { ordered_qty: number; delivered_qty: number }[];
    return lines.some((l) => l.delivered_qty < l.ordered_qty);
  });

  return (
    <div className="space-y-4">
      <div>
        <Link href="/delivery-challans" className="text-xs text-ink-faint hover:text-ink">
          ← Delivery Challans
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">Nayi Delivery Challan</h1>
      </div>

      {!eligible.length ? (
        <div className="rounded-xl border border-warn bg-warn-soft p-5 text-sm text-warn max-w-xl">
          Koi Sales Order nahi mili jis mein delivery ke liye pending qty ho.{" "}
          <Link href="/sales-orders" className="underline underline-offset-2 font-medium">
            Sales Orders dekhen
          </Link>
          .
        </div>
      ) : !warehouses?.length ? (
        <div className="rounded-xl border border-warn bg-warn-soft p-5 text-sm text-warn max-w-xl">
          Pehle kam az kam ek warehouse honi chahiye.{" "}
          <Link href="/setup/warehouses" className="underline underline-offset-2 font-medium">
            Warehouse add karen
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
