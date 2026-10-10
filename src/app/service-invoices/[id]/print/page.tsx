import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AUTO_PRINT_SCRIPT } from "@/lib/printStyles";
import { getCompanyBrandingUrls } from "@/lib/companyBranding";
import { formatInvoiceDate } from "@/lib/docRef";
import { ServiceInvoiceDoc } from "@/components/print/ServiceInvoiceDoc";
import { PrintBackLink } from "@/components/PrintBackLink";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: invoice } = await supabase.from("service_invoices").select("invoice_no").eq("id", id).maybeSingle();
  return { title: invoice?.invoice_no ?? "Service Invoice" };
}

export default async function ServiceInvoicePrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ signature?: string; stamp?: string; autoprint?: string }>;
}) {
  const { id } = await params;
  const { signature, stamp, autoprint } = await searchParams;
  const supabase = await createClient();

  const [{ data: invoice }, { data: company }, { data: lines }] = await Promise.all([
    supabase.from("service_invoices").select("*, parties(legal_name, billing_address, ntn, strn)").eq("id", id).maybeSingle(),
    supabase.from("company").select("*").maybeSingle(),
    supabase.from("service_invoice_lines").select("*").eq("service_invoice_id", id).order("sort_order"),
  ]);

  if (!invoice) notFound();

  const [{ logoUrl, signatureUrl, stampUrl, footerUrl }, { data: contacts }] = await Promise.all([
    getCompanyBrandingUrls(supabase, company, { signature: signature === "1", stamp: stamp === "1" }),
    supabase.from("party_contacts").select("phone, is_primary").eq("party_id", invoice.party_id).not("phone", "is", null).order("is_primary", { ascending: false }).limit(1),
  ]);

  const party = invoice.parties as unknown as { legal_name: string; billing_address: string | null; ntn: string | null; strn: string | null } | null;

  return (
    <>
      {autoprint !== "0" && <PrintBackLink href={`/service-jobs/${invoice.service_job_id}`} />}
      <ServiceInvoiceDoc
        invoiceNo={invoice.invoice_no}
        date={formatInvoiceDate(invoice.invoice_date)}
        seller={{
          name: company?.legal_name ?? "Company",
          address: company?.address ?? null,
          phone: company?.phone ?? null,
          ntn: company?.ntn ?? null,
          sntn: company?.strn ?? null,
        }}
        buyer={{
          name: party?.legal_name ?? "",
          address: party?.billing_address ?? null,
          phone: contacts?.[0]?.phone ?? null,
          ntn: party?.ntn ?? null,
          sntn: party?.strn ?? null,
        }}
        clientPoNo={invoice.client_po_no}
        lines={(lines ?? []).map((l) => ({
          description: l.description,
          qty: Number(l.qty),
          rate: Number(l.rate),
          tax_pct: Number(l.tax_pct),
          amount: Number(l.amount),
        }))}
        note={company?.service_invoice_note ?? null}
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
