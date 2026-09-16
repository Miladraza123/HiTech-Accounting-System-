import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { buildExcelResponse } from "@/lib/excelExport";

export async function GET() {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "accounts") || hasRole(user, "auditor"))) {
    return new Response("Forbidden", { status: 403 });
  }

  const supabase = await createClient();
  // Shares fn_ap_aging with the AP Aging screen — see the AR export.
  const { data: aged } = await supabase.rpc("fn_ap_aging");

  const rows = (aged ?? []).map((r) => ({
    supplier: r.name ?? "—",
    current: r.bucket_current,
    d1_30: r.bucket_1_30,
    d31_60: r.bucket_31_60,
    d61_90: r.bucket_61_90,
    d90_plus: r.bucket_90_plus,
    total: r.total,
  }));

  return buildExcelResponse(
    "AP Aging",
    [
      { header: "Supplier", key: "supplier", width: 30 },
      { header: "Current", key: "current" },
      { header: "1-30 Days", key: "d1_30" },
      { header: "31-60 Days", key: "d31_60" },
      { header: "61-90 Days", key: "d61_90" },
      { header: "90+ Days", key: "d90_plus" },
      { header: "Total", key: "total" },
    ],
    rows,
    "ap-aging.xlsx"
  );
}
