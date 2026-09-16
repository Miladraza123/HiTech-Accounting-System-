import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchLineItems } from "@/lib/itemOptions";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { NewStockTransferForm } from "@/components/NewStockTransferForm";

export default async function NewStockTransferPage() {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "stock_transfer.create"))) redirect("/stock-transfers");

  const supabase = await createClient();
  const [{ data: warehouses }, items] = await Promise.all([
    supabase.from("warehouses").select("*").eq("is_active", true).order("name"),
    fetchLineItems(supabase),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">New Stock Transfer</h1>
        <p className="mt-1 text-sm text-ink-soft">Move stock from one warehouse to another.</p>
      </div>
      <NewStockTransferForm warehouses={warehouses ?? []} items={items} />
    </div>
  );
}
