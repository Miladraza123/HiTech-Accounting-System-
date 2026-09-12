import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { buildExcelResponse } from "@/lib/excelExport";

export async function GET() {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "accounts") || hasRole(user, "auditor"))) {
    return new Response("Forbidden", { status: 403 });
  }

  const supabase = await createClient();
  const { data: rows } = await supabase.from("trial_balance").select("*").order("code");

  const active = (rows ?? []).filter((r) => (r.total_debit ?? 0) !== 0 || (r.total_credit ?? 0) !== 0);

  return buildExcelResponse(
    "Trial Balance",
    [
      { header: "Code", key: "code" },
      { header: "Account", key: "name", width: 30 },
      { header: "Type", key: "account_type" },
      { header: "Debit", key: "total_debit" },
      { header: "Credit", key: "total_credit" },
      { header: "Balance", key: "balance" },
    ],
    active.map((r) => ({
      code: r.code,
      name: r.name,
      account_type: r.account_type,
      total_debit: r.total_debit ?? 0,
      total_credit: r.total_credit ?? 0,
      balance: r.balance ?? 0,
    })),
    "trial-balance.xlsx"
  );
}
