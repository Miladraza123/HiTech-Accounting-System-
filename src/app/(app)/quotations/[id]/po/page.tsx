import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { convertedLineIds, isLineOrdered } from "@/lib/poFromQuotation";
import { NewPoFromQuotationForm } from "@/components/NewPoFromQuotationForm";

export default async function PoFromQuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "sales_order.manage"))) redirect(`/quotations/${id}`);

  const supabase = await createClient();
  const [{ data: quotation }, { data: revision }] = await Promise.all([
    supabase.from("quotations").select("id, quotation_no, status, party_id, parties(legal_name, credit_limit)").eq("id", id).maybeSingle(),
    supabase.from("quotation_revisions").select("*").eq("quotation_id", id).eq("is_current", true).maybeSingle(),
  ]);
  if (!quotation || !revision) notFound();
  if (quotation.status === "Draft") redirect(`/quotations/${id}`);

  const [{ data: lines }, { data: orders }, { data: jobs }] = await Promise.all([
    supabase.from("quotation_lines").select("*").eq("revision_id", revision.id).order("sort_order"),
    supabase.from("sales_orders").select("id").eq("quotation_id", id).neq("status", "Cancelled"),
    supabase.from("service_jobs").select("quoted_lines").eq("quotation_id", id).neq("status", "Cancelled"),
  ]);
  const orderIds = (orders ?? []).map((o) => o.id);
  const { data: soLines } = orderIds.length
    ? await supabase.from("sales_order_lines").select("quotation_line_id").in("sales_order_id", orderIds).not("quotation_line_id", "is", null)
    : { data: [] };
  const done = convertedLineIds(soLines ?? [], jobs ?? []);

  // Lines of every revision, so a line continued from an earlier revision still counts as ordered.
  const { data: revs } = await supabase.from("quotation_revisions").select("id").eq("quotation_id", id);
  const { data: allLines } = (revs ?? []).length
    ? await supabase.from("quotation_lines").select("id, source_line_id").in("revision_id", (revs ?? []).map((r) => r.id))
    : { data: [] };
  const sourceOf = new Map((allLines ?? []).map((l) => [l.id, l.source_line_id] as [string, string | null]));

  let creditWarning: string | null = null;
  const party = quotation.parties as unknown as { legal_name: string; credit_limit: number } | null;
  if (party && party.credit_limit > 0) {
    const { data: ar } = await supabase.from("party_ar_summary").select("total_outstanding").eq("party_id", quotation.party_id).maybeSingle();
    const outstanding = ar?.total_outstanding ?? 0;
    if (outstanding >= party.credit_limit) {
      creditWarning = `${party.legal_name}'s current outstanding (${outstanding.toLocaleString()}) has already reached or exceeded the credit limit (${party.credit_limit.toLocaleString()})`;
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/quotations/${id}`} className="text-xs text-ink-faint hover:text-ink">
          ← {quotation.quotation_no}
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">Client PO Received</h1>
        <p className="text-sm text-ink-soft">
          {party?.legal_name} — each line becomes a Material Supply Sales Order, a Fabrication Sales Order or a Service Job, by its type.
        </p>
      </div>
      <NewPoFromQuotationForm
        quotationId={id}
        lines={(lines ?? []).map((l) => ({
          id: l.id,
          item_id: l.item_id,
          description: l.description,
          qty: Number(l.qty),
          unit: l.unit,
          rate: Number(l.rate),
          tax_pct: Number(l.tax_pct),
          line_type: l.line_type,
          alreadyDone: isLineOrdered(l.id, sourceOf, done),
        }))}
        defaultPaymentTerms={revision.payment_terms ?? null}
        creditWarning={creditWarning}
      />
    </div>
  );
}
