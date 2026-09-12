import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { buildExcelResponse } from "@/lib/excelExport";

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

export async function GET() {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "sales") || hasRole(user, "accounts") || hasRole(user, "auditor"))) {
    return new Response("Forbidden", { status: 403 });
  }

  const supabase = await createClient();
  const { data: soLines } = await supabase
    .from("sales_order_lines")
    .select("*, sales_orders!inner(so_no, client_po_number, po_date, status, parties(legal_name))")
    .not("sales_orders.status", "in", "(Cancelled,Closed)");

  type SoInfo = { so_no: string; client_po_number: string; po_date: string; status: string; parties: { legal_name: string } | null };
  const rows = (soLines ?? [])
    .map((l) => {
      const so = l.sales_orders as unknown as SoInfo;
      return {
        so_no: so.so_no,
        client: so.parties?.legal_name ?? "—",
        description: l.description,
        ordered: l.ordered_qty,
        delivered: l.delivered_qty,
        pending_deliver: l.ordered_qty - l.delivered_qty,
        invoiced: l.invoiced_qty,
        pending_invoice: l.delivered_qty - l.invoiced_qty,
        days_since_po: daysSince(so.po_date),
      };
    })
    .filter((r) => r.pending_deliver > 0.001 || r.pending_invoice > 0.001)
    .sort((a, b) => b.days_since_po - a.days_since_po);

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
