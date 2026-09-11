import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { NewPurchaseOrderForm } from "@/components/NewPurchaseOrderForm";

export default async function NewPurchaseOrderPage() {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "store"))) redirect("/purchase-orders");

  const supabase = await createClient();
  const [{ data: suppliers }, { data: salesOrders }, { data: warehouses }, { data: items }, { data: units }] = await Promise.all([
    supabase.from("parties").select("*").eq("is_active", true).in("party_type", ["supplier", "both"]).order("legal_name"),
    supabase
      .from("sales_orders")
      .select("*, parties(legal_name)")
      .eq("business_line", "material_supply")
      .not("status", "in", "(Cancelled,Closed)")
      .order("created_at", { ascending: false }),
    supabase.from("warehouses").select("*").eq("is_active", true).order("name"),
    supabase.from("items").select("*").eq("is_active", true).order("item_code"),
    supabase.from("units").select("*").order("code"),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <Link href="/purchase-orders" className="text-xs text-ink-faint hover:text-ink">
          ← Purchase Orders
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">Nayi Purchase Order</h1>
      </div>

      {!suppliers?.length ? (
        <div className="rounded-xl border border-warn bg-warn-soft p-5 text-sm text-warn max-w-xl">
          Pehle koi supplier honi chahiye.{" "}
          <Link href="/clients" className="underline underline-offset-2 font-medium">
            Supplier add karen
          </Link>
          .
        </div>
      ) : (
        <NewPurchaseOrderForm
          suppliers={suppliers}
          salesOrders={(salesOrders ?? []).map((so) => ({
            id: so.id,
            so_no: so.so_no,
            client_po_number: so.client_po_number,
            parties: so.parties as unknown as { legal_name: string } | null,
          }))}
          warehouses={warehouses ?? []}
          items={items ?? []}
          units={units ?? []}
        />
      )}
    </div>
  );
}
