import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { buildExcelResponse } from "@/lib/excelExport";

function defaultMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { from, to };
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "accounts") || hasRole(user, "auditor"))) {
    return new Response("Forbidden", { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const defaults = defaultMonthRange();
  const fromDate = searchParams.get("from") || defaults.from;
  const toDate = searchParams.get("to") || defaults.to;

  const supabase = await createClient();
  const { data: payments } = await supabase
    .from("payments")
    .select("*, parties(legal_name)")
    .gte("payment_date", fromDate)
    .lte("payment_date", toDate)
    .eq("status", "Posted")
    .order("payment_date", { ascending: false });

  const rows = (payments ?? []).map((p) => ({
    payment_no: p.payment_no,
    party: (p.parties as unknown as { legal_name: string } | null)?.legal_name ?? "—",
    direction: p.direction,
    method: p.method ?? "",
    date: p.payment_date,
    amount: p.amount,
  }));

  return buildExcelResponse(
    "Payment Collection",
    [
      { header: "Payment #", key: "payment_no" },
      { header: "Party", key: "party", width: 30 },
      { header: "Direction", key: "direction" },
      { header: "Method", key: "method" },
      { header: "Date", key: "date" },
      { header: "Amount", key: "amount" },
    ],
    rows,
    `payment-collection-${fromDate}-to-${toDate}.xlsx`
  );
}
