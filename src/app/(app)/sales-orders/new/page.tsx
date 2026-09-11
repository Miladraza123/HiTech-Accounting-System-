import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { NewSalesOrderForm } from "@/components/NewSalesOrderForm";

export default async function NewSalesOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ quotation_id?: string }>;
}) {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "sales"))) redirect("/quotations");

  const { quotation_id } = await searchParams;
  if (!quotation_id) redirect("/quotations");

  const supabase = await createClient();
  const [{ data: quotation }, { data: items }, { data: units }, { data: company }] = await Promise.all([
    supabase.from("quotations").select("*, parties(legal_name, credit_limit)").eq("id", quotation_id).maybeSingle(),
    supabase.from("items").select("*").eq("is_active", true).order("item_code"),
    supabase.from("units").select("*").order("code"),
    supabase.from("company").select("default_sales_tax_pct").maybeSingle(),
  ]);

  if (!quotation) notFound();

  let creditWarning: string | null = null;
  const partyInfo = quotation.parties as unknown as { legal_name: string; credit_limit: number } | null;
  if (partyInfo && partyInfo.credit_limit > 0) {
    const { data: ar } = await supabase.from("party_ar_summary").select("total_outstanding").eq("party_id", quotation.party_id).maybeSingle();
    const outstanding = ar?.total_outstanding ?? 0;
    if (outstanding >= partyInfo.credit_limit) {
      creditWarning = `${partyInfo.legal_name} ki current outstanding (${outstanding.toLocaleString()}) already credit limit (${partyInfo.credit_limit.toLocaleString()}) tak ya us se zyada hai`;
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
        <h1 className="text-lg font-semibold text-ink mt-1">Nayi Sales Order</h1>
        <p className="text-sm text-ink-soft">{partyInfo?.legal_name} — Quotation lines se pre-filled, zaroorat ho to badal len.</p>
      </div>

      <NewSalesOrderForm
        quotationId={quotation_id}
        quotationLines={quotationLines ?? []}
        items={items ?? []}
        units={units ?? []}
        defaultPaymentTerms={revision?.payment_terms ?? null}
        defaultTaxPct={company?.default_sales_tax_pct ?? 18}
        creditWarning={creditWarning}
      />
    </div>
  );
}
