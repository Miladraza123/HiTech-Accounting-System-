import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { buildExcelResponse } from "@/lib/excelExport";

// A spreadsheet export is meant to contain every matching row, so unlike the
// screen this asks for all of them — but it shares the screen's
// fn_pending_orders, so the "is anything still pending" filter now runs in
// SQL and only genuinely pending lines cross the network, instead of every
// line of every open order. The cap is a safety valve, not a page size.
const EXPORT_ROW_CAP = 50000;

export async function GET() {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "sales") || hasRole(user, "accounts") || hasRole(user, "auditor"))) {
    return new Response("Forbidden", { status: 403 });
  }

  const supabase = await createClient();
  const { data: pending } = await supabase.rpc("fn_pending_orders", { p_limit: EXPORT_ROW_CAP, p_offset: 0 });

  const rows = (pending ?? []).map((r) => ({
    so_no: r.so_no,
    client: r.client,
    description: r.description,
    ordered: r.ordered,
    delivered: r.delivered,
    pending_deliver: r.pending_deliver,
    invoiced: r.invoiced,
    pending_invoice: r.pending_invoice,
    days_since_po: r.days,
  }));

  return buildExcelResponse(
    "Pending Orders",
    [
      { header: "SO #", key: "so_no" },
      { header: "Client", key: "client", width: 25 },
      { header: "Description", key: "description", width: 30 },
      { header: "Ordered", key: "ordered" },
      { header: "Delivered", key: "delivered" },
      { header: "Pending Deliver", key: "pending_deliver" },
      { header: "Invoiced", key: "invoiced" },
      { header: "Pending Invoice", key: "pending_invoice" },
      { header: "Days Since PO", key: "days_since_po" },
    ],
    rows,
    "pending-orders.xlsx"
  );
}
