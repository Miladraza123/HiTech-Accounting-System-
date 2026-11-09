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
  const { data } = await supabase.from("service_material_docs").select("doc_no").eq("id", id).maybeSingle();
  return { title: data?.doc_no ?? "Site Material DC" };
}

/** The Raw Material DC for a Service Job: the client's own challan form, quantities only (no cost). */
export default async function ServiceMaterialPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ signature?: string; stamp?: string; autoprint?: string }>;
}) {
  const { id } = await params;
  const { signature, stamp, autoprint } = await searchParams;
  const supabase = await createClient();

  const [{ data: doc }, { data: company }, { data: lines }] = await Promise.all([
    supabase
      .from("service_material_docs")
      .select("*, parties(legal_name), service_jobs(job_no, client_po_no, asset_description)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("company").select("*").maybeSingle(),
    supabase.from("service_material_lines").select("*").eq("doc_id", id).order("sort_order"),
  ]);
  if (!doc) notFound();

  const { logoUrl, signatureUrl, stampUrl } = await getCompanyBrandingUrls(supabase, company, {
    signature: signature === "1",
    stamp: stamp === "1",
  });

  const party = doc.parties as unknown as { legal_name: string } | null;
  const job = doc.service_jobs as unknown as { job_no: string; client_po_no: string | null; asset_description: string } | null;
  const extra = [doc.vehicle_no && `Vehicle: ${doc.vehicle_no}`, doc.driver_name && `Driver: ${doc.driver_name}`, doc.remarks].filter(Boolean).join(" · ");

  return (
    <>
      {autoprint !== "0" && <PrintBackLink href={`/service-jobs/${doc.service_job_id}`} />}
      <DcDoc
        dcNo={doc.doc_no}
        date={formatDcDate(doc.doc_date)}
        partyName={party?.legal_name ?? ""}
        refNo={job?.client_po_no ?? null}
        project={job ? `Raw material for site work — ${job.job_no}` : null}
        lines={(lines ?? []).map((l) => ({ qty: Number(l.qty), unit: l.unit, description: l.description, remarks: null }))}
        remarks={extra || null}
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
