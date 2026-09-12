import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { NewSalesOrderForm } from "@/components/NewSalesOrderForm";

export default async function NewSalesOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ quotation_id?: string }>;
}) {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "sales_order.manage"))) redirect("/quotations");

  const { quotation_id } = await searchParams;
  if (!quotation_id) redirect("/quotations");

  const supabase = await createClient();
  const [{ data: quotation }, { data: items }, { data: units }, { data: altUnits }, { data: company }] = await Promise.all([
    supabase.from("quotations").select("*, parties(legal_name, credit_limit)").eq("id", quotation_id).maybeSingle(),
    supabase.from("items").select("*").eq("is_active", true).order("item_code"),
    supabase.from("units").select("*").order("code"),
    supabase.from("item_alt_units").select("*").eq("is_active", true),
    supabase.from("company").select("default_sales_tax_pct").maybeSingle(),
  ]);

  if (!quotation) notFound();

  let creditWarning: string | null = null;
  const partyInfo = quotation.parties as unknown as { legal_name: string; credit_limit: number } | null;
  if (partyInfo && partyInfo.credit_limit > 0) {
    const { data: ar } = await supabase.from("party_ar_summary").select("total_outstanding").eq("party_id", quotation.party_id).maybeSingle();
    const outstanding = ar?.total_outstanding ?? 0;
    if (outstanding >= partyInfo.credit_limit) {
      creditWarning = `${partyInfo.legal_name}'s current outstanding (${outstanding.toLocaleString()}) has already reached or exceeded the credit limit (${partyInfo.credit_limit.toLocaleString()})`;
    }
  }

  const { data: revision } = await supabase
    .from("quotation_revisions")
    .select("*")
    .eq("quotation_id", quotation_id)
    .eq("is_current", true)
    .maybeSingle();

  const { data: quotationLines } = revision
    ? await supabase.from("quotation_lines").select("*").eq("revision_id", revision.id).order("sort_order")
    : { data: [] };

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/quotations/${quotation_id}`} className="text-xs text-ink-faint hover:text-ink">
          ← {quotation.quotation_no}
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">New Sales Order</h1>
        <p className="text-sm text-ink-soft">{partyInfo?.legal_name} — Pre-filled from Quotation lines, change if needed.</p>
      </div>

      <NewSalesOrderForm
        quotationId={quotation_id}
        quotationLines={quotationLines ?? []}
        items={items ?? []}
        units={units ?? []}
        altUnits={altUnits ?? []}
        defaultPaymentTerms={revision?.payment_terms ?? null}
        defaultTaxPct={company?.default_sales_tax_pct ?? 18}
        creditWarning={creditWarning}
      />
    </div>
  );
}
