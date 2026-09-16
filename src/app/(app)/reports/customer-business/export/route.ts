import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { buildExcelResponse } from "@/lib/excelExport";

export async function GET() {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "sales") || hasRole(user, "accounts") || hasRole(user, "auditor"))) {
    return new Response("Forbidden", { status: 403 });
  }

  const supabase = await createClient();
  // Shares fn_customer_business with the screen, so the export cannot drift
  // from what the report shows and neither pulls the order/invoice tables in
  // full — see the page for the full reasoning.
  const { data: business } = await supabase.rpc("fn_customer_business");

  const rows = (business ?? []).map((r) => ({
    client: r.name,
    order_count: r.order_count,
    order_value: r.order_value,
    invoiced: r.invoiced,
    outstanding: r.outstanding,
    last_order: r.last_order_date ? r.last_order_date.slice(0, 10) : "",
  }));

  return buildExcelResponse(
    "Customer Business",
    [
      { header: "Client", key: "client", width: 30 },
      { header: "# Orders", key: "order_count" },
      { header: "Order Value", key: "order_value" },
      { header: "Invoiced", key: "invoiced" },
      { header: "Outstanding", key: "outstanding" },
      { header: "Last Order", key: "last_order" },
    ],
    rows,
    "customer-business.xlsx"
  );
}
