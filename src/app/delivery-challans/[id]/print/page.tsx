import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AUTO_PRINT_SCRIPT } from "@/lib/printStyles";
import { getCompanyBrandingUrls } from "@/lib/companyBranding";
import { formatDcDate } from "@/lib/docRef";
import { DcDoc } from "@/components/print/DcDoc";
import { PrintBackLink } from "@/components/PrintBackLink";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: dc } = await supabase.from("delivery_challans").select("dc_no").eq("id", id).maybeSingle();
  return { title: dc?.dc_no ?? "Delivery Challan" };
}

export default async function DeliveryChallanPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ signature?: string; stamp?: string; autoprint?: string }>;
}) {
  const { id } = await params;
  const { signature, stamp, autoprint } = await searchParams;
  const supabase = await createClient();

  const [{ data: dc }, { data: company }, { data: lines }] = await Promise.all([
    supabase.from("delivery_challans").select("*, parties(legal_name), sales_orders(client_po_number)").eq("id", id).maybeSingle(),
    supabase.from("company").select("*").maybeSingle(),
    supabase.from("delivery_challan_lines").select("*").eq("dc_id", id).order("sort_order"),
  ]);

  if (!dc) notFound();

  const { logoUrl, signatureUrl, stampUrl } = await getCompanyBrandingUrls(supabase, company, {
    signature: signature === "1",
    stamp: stamp === "1",
  });

  const party = dc.parties as unknown as { legal_name: string } | null;
  const so = dc.sales_orders as unknown as { client_po_number: string | null } | null;

  return (
    <>
      {autoprint !== "0" && <PrintBackLink href={`/delivery-challans/${id}`} />}
      <DcDoc
        dcNo={dc.dc_no}
        date={formatDcDate(dc.delivery_date)}
        partyName={party?.legal_name ?? ""}
        refNo={dc.ref_no ?? so?.client_po_number ?? null}
        lines={(lines ?? []).map((l) => ({
          qty: Number(l.delivered_qty),
          unit: l.unit,
          description: l.description,
          remarks: l.remarks,
        }))}
        remarks={dc.remarks}
        company={{
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
        tagline={company?.print_tagline ?? null}
        signatureUrl={signatureUrl}
        stampUrl={stampUrl}
      />
      <script dangerouslySetInnerHTML={{ __html: AUTO_PRINT_SCRIPT }} />
    </>
  );
}
