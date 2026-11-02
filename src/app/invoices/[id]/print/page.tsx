import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AUTO_PRINT_SCRIPT } from "@/lib/printStyles";
import { getCompanyBrandingUrls } from "@/lib/companyBranding";
import { formatLongDate } from "@/lib/docRef";
import { GstInvoiceDoc } from "@/components/print/GstInvoiceDoc";
import { PrintBackLink } from "@/components/PrintBackLink";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: invoice } = await supabase.from("invoices").select("invoice_no").eq("id", id).maybeSingle();
  return { title: invoice?.invoice_no ?? "Invoice" };
}

const SECTION_LABEL: Record<string, string> = { material_supply: "MATERIAL", fabrication: "FABRICATION" };

export default async function InvoicePrintPage({
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
    supabase
      .from("invoices")
      .select("*, parties(legal_name, billing_address, ntn, strn), sales_orders(so_no, client_po_number, business_line)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("company").select("*").maybeSingle(),
    supabase.from("invoice_lines").select("*, items(hs_code)").eq("invoice_id", id).order("sort_order"),
  ]);

  if (!invoice) notFound();

  const [{ logoUrl, signatureUrl, stampUrl, footerUrl }, { data: contacts }] = await Promise.all([
    getCompanyBrandingUrls(supabase, company, { signature: signature === "1", stamp: stamp === "1" }),
    supabase
      .from("party_contacts")
      .select("phone, email, is_primary")
      .eq("party_id", invoice.party_id)
      .order("is_primary", { ascending: false })
      .limit(1),
  ]);

  const party = invoice.parties as unknown as { legal_name: string; billing_address: string | null; ntn: string | null; strn: string | null } | null;
  const so = invoice.sales_orders as unknown as { so_no: string; client_po_number: string; business_line: string } | null;
  const contact = contacts?.[0];

  return (
    <>
      {autoprint !== "0" && <PrintBackLink href={`/invoices/${id}`} />}
      <GstInvoiceDoc
        invoiceNo={invoice.invoice_no}
        date={formatLongDate(invoice.invoice_date)}
        seller={{
          name: company?.legal_name ?? "Company",
          ntn: company?.ntn ?? null,
          strn: company?.strn ?? null,
          address: company?.address ?? null,
          phones: [company?.phone, company?.phone2].filter((x): x is string => !!x),
          email: company?.email ?? null,
        }}
        buyer={{
          name: party?.legal_name ?? "",
          ntn: party?.ntn ?? null,
          strn: party?.strn ?? null,
          address: party?.billing_address ?? null,
          phone: contact?.phone ?? null,
          email: contact?.email ?? null,
          contactPerson: invoice.contact_person,
        }}
        poNo={so?.client_po_number ?? null}
        dcRefs={invoice.dc_refs}
        paymentTerms={invoice.payment_terms}
        dueDate={invoice.due_date ? formatLongDate(invoice.due_date) : null}
        sectionLabel={SECTION_LABEL[so?.business_line ?? ""] ?? "MATERIAL"}
        lines={(lines ?? []).map((l) => {
          const item = l.items as unknown as { hs_code: string | null } | null;
          return {
            description: l.description,
            // What was written on the invoice line wins; older invoices fall back to the Item's code.
            hsCode: l.hs_code ?? item?.hs_code ?? null,
            unit: l.unit,
            qty: Number(l.qty),
            rate: Number(l.rate),
            amount: l.amount === null ? Number(l.qty) * Number(l.rate) : Number(l.amount),
            taxPct: Number(l.tax_pct),
          };
        })}
        totalWeight={invoice.total_weight}
        note={invoice.print_note}
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
