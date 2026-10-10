import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AUTO_PRINT_SCRIPT } from "@/lib/printStyles";
import { getCompanyBrandingUrls } from "@/lib/companyBranding";
import { formatQuoteDate, quotationRef, validityDays } from "@/lib/docRef";
import { QuotationDoc } from "@/components/print/QuotationDoc";
import { PrintBackLink } from "@/components/PrintBackLink";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: quotation } = await supabase.from("quotations").select("quotation_no").eq("id", id).maybeSingle();
  return { title: quotation?.quotation_no ?? "Quotation" };
}

export default async function QuotationPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ signature?: string; stamp?: string; autoprint?: string }>;
}) {
  const { id } = await params;
  const { signature, stamp, autoprint } = await searchParams;
  const supabase = await createClient();

  const [{ data: quotation }, { data: company }] = await Promise.all([
    supabase.from("quotations").select("*, parties(legal_name, short_code)").eq("id", id).maybeSingle(),
    supabase.from("company").select("*").maybeSingle(),
  ]);

  if (!quotation) notFound();

  const { logoUrl, signatureUrl, stampUrl, footerUrl } = await getCompanyBrandingUrls(supabase, company, {
    signature: signature === "1",
    stamp: stamp === "1",
  });

  const { data: revision } = await supabase
    .from("quotation_revisions")
    .select("*")
    .eq("quotation_id", id)
    .eq("is_current", true)
    .maybeSingle();

  if (!revision) notFound();

  const { data: lines } = await supabase.from("quotation_lines").select("*").eq("revision_id", revision.id).order("sort_order");

  const party = quotation.parties as unknown as { legal_name: string; short_code: string | null } | null;
  const days = validityDays(revision.created_at, revision.validity_date);

  return (
    <>
      {autoprint !== "0" && <PrintBackLink href={`/quotations/${id}`} />}
      <QuotationDoc
        companyName={company?.legal_name ?? "Company"}
        refNo={quotationRef(company?.short_code, party?.short_code, quotation.quotation_no)}
        date={formatQuoteDate(revision.created_at)}
        partyName={party?.legal_name ?? ""}
        attn={quotation.attn}
        subject={quotation.subject}
        lines={(lines ?? []).map((l) => ({
          description: l.description,
          rate: Number(l.rate),
          qty: Number(l.qty),
          unit: l.unit,
          tax_pct: Number(l.tax_pct),
          amount: Number(l.amount),
        }))}
        subtotal={Number(revision.subtotal)}
        taxTotal={Number(revision.tax_total)}
        grandTotal={Number(revision.grand_total)}
        currency={company?.base_currency ?? "PKR"}
        completionTime={revision.delivery_terms}
        validityText={days === null ? null : `${days} ${days === 1 ? "DAY" : "DAYS"}`}
        signatoryName={company?.signatory_name ?? null}
        headerCompany={{
          name: company?.legal_name ?? "Company",
          phone: company?.phone ?? null,
          phone2: company?.phone2 ?? null,
          email: company?.email ?? null,
          email2: company?.email2 ?? null,
          address: company?.address ?? null,
          ntn: company?.ntn ?? null,
          strn: company?.strn ?? null,
        }}
        logoUrl={logoUrl}
        footerUrl={footerUrl}
        signatureUrl={signatureUrl}
        stampUrl={stampUrl}
      />
      <script dangerouslySetInnerHTML={{ __html: AUTO_PRINT_SCRIPT }} />
    </>
  );
}
