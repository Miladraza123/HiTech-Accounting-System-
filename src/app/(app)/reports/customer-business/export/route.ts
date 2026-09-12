import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { buildExcelResponse } from "@/lib/excelExport";

export async function GET() {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "sales") || hasRole(user, "accounts") || hasRole(user, "auditor"))) {
    return new Response("Forbidden", { status: 403 });
  }

  const supabase = await createClient();
  const [{ data: parties }, { data: salesOrders }, { data: invoices }, { data: outstanding }] = await Promise.all([
    supabase.from("parties").select("id, legal_name").in("party_type", ["client", "both"]),
    supabase.from("sales_orders").select("id, party_id, grand_total, status, created_at").not("status", "eq", "Cancelled"),
    supabase.from("invoices").select("id, party_id, grand_total, status"),
    supabase.from("invoice_outstanding").select("party_id, outstanding_amount"),
  ]);

  const soByParty = new Map<string, { total: number; count: number; lastDate: string | null }>();
  for (const s of salesOrders ?? []) {
    const existing = soByParty.get(s.party_id) ?? { total: 0, count: 0, lastDate: null };
    existing.total += s.grand_total;
    existing.count += 1;
    if (!existing.lastDate || s.created_at > existing.lastDate) existing.lastDate = s.created_at;
    soByParty.set(s.party_id, existing);
  }
  const invoicedByParty = new Map<string, number>();
  for (const inv of invoices ?? []) {
    if (inv.status !== "Posted") continue;
    invoicedByParty.set(inv.party_id, (invoicedByParty.get(inv.party_id) ?? 0) + inv.grand_total);
  }
  const outstandingByParty = new Map<string, number>();
  for (const o of outstanding ?? []) {
    if (!o.party_id) continue;
    outstandingByParty.set(o.party_id, (outstandingByParty.get(o.party_id) ?? 0) + (o.outstanding_amount ?? 0));
  }

  const rows = (parties ?? [])
    .map((p) => {
      const so = soByParty.get(p.id) ?? { total: 0, count: 0, lastDate: null };
      return {
        client: p.legal_name,
        order_count: so.count,
        order_value: so.total,
        invoiced: invoicedByParty.get(p.id) ?? 0,
        outstanding: outstandingByParty.get(p.id) ?? 0,
        last_order: so.lastDate ? so.lastDate.slice(0, 10) : "",
      };
    })
    .filter((r) => r.order_count > 0)
    .sort((a, b) => b.order_value - a.order_value);

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
