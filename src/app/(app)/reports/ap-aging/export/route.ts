import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { agingBucket, dueDateFrom, emptyBuckets, type Buckets } from "@/lib/aging";
import { buildExcelResponse } from "@/lib/excelExport";

export async function GET() {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "accounts") || hasRole(user, "auditor"))) {
    return new Response("Forbidden", { status: 403 });
  }

  const supabase = await createClient();
  const [{ data: outstanding }, { data: bills }, { data: parties }] = await Promise.all([
    supabase.from("supplier_bill_outstanding").select("*").gt("outstanding_amount", 0),
    supabase.from("supplier_bills").select("id, bill_date, supplier_id"),
    supabase.from("parties").select("id, legal_name, credit_days"),
  ]);

  const billById = new Map((bills ?? []).map((b) => [b.id, b]));
  const partyById = new Map((parties ?? []).map((p) => [p.id, p]));

  const perParty = new Map<string, Buckets>();
  for (const o of outstanding ?? []) {
    const bill = billById.get(o.supplier_bill_id!);
    const party = partyById.get(o.supplier_id!);
    if (!bill || !party) continue;
    const bucket = agingBucket(dueDateFrom(bill.bill_date, party.credit_days ?? 0));
    const rec = perParty.get(party.id) ?? emptyBuckets();
    rec[bucket] += o.outstanding_amount ?? 0;
    perParty.set(party.id, rec);
  }

  const rows = Array.from(perParty.entries())
    .map(([partyId, b]) => ({
      supplier: partyById.get(partyId)?.legal_name ?? "—",
      current: b.current,
      d1_30: b.d1_30,
      d31_60: b.d31_60,
      d61_90: b.d61_90,
      d90_plus: b.d90_plus,
      total: b.current + b.d1_30 + b.d31_60 + b.d61_90 + b.d90_plus,
    }))
    .sort((a, b) => b.total - a.total);

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
