import { createClient } from "@/lib/supabase/server";
import { printStyles, AUTO_PRINT_SCRIPT } from "@/lib/printStyles";
import { getCompanyBrandingUrls } from "@/lib/companyBranding";
import { PrintLogoBlock } from "@/components/PrintLogoBlock";
import { PrintFooter } from "@/components/PrintFooter";
import { PrintWatermark } from "@/components/PrintWatermark";
import { PrintSignoff } from "@/components/PrintSignoff";
import { PrintBackLink } from "@/components/PrintBackLink";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Raw Material Shortage" };

export default async function RawMaterialShortagePrintPage({
  searchParams,
}: {
  searchParams: Promise<{ signature?: string; stamp?: string; phone?: string; email?: string; autoprint?: string }>;
}) {
  const { signature, stamp, phone, email, autoprint } = await searchParams;

  const supabase = await createClient();
  const [{ data: requirements }, { data: company }] = await Promise.all([
    supabase
      .from("job_material_requirements")
      .select("item_id, required_qty, reserved_qty, issued_qty, returned_qty, source, unit, items(item_code, description, base_unit), jobs!inner(job_no, status)")
      .eq("source", "stock")
      .eq("jobs.status", "MaterialPending"),
    supabase.from("company").select("*").maybeSingle(),
  ]);

  type ItemInfo = { item_code: string; description: string; base_unit: string } | null;
  type JobInfo = { job_no: string; status: string };

  const byItem = new Map<string, { item: ItemInfo; unit: string | null; shortfall: number; jobNos: Set<string> }>();
  for (const r of requirements ?? []) {
    const shortfall = r.required_qty - r.reserved_qty - (r.issued_qty - r.returned_qty);
    if (shortfall <= 0.001) continue;
    const item = r.items as unknown as ItemInfo;
    const job = r.jobs as unknown as JobInfo;
    const rec = byItem.get(r.item_id) ?? { item, unit: r.unit, shortfall: 0, jobNos: new Set<string>() };
    rec.shortfall += shortfall;
    rec.jobNos.add(job.job_no);
    byItem.set(r.item_id, rec);
  }

  const rows = Array.from(byItem.entries())
    .map(([itemId, r]) => ({ itemId, ...r, jobList: Array.from(r.jobNos).join(", ") }))
    .sort((a, b) => b.shortfall - a.shortfall);

  const { logoUrl, signatureUrl, stampUrl } = await getCompanyBrandingUrls(supabase, company, {
    signature: signature === "1",
    stamp: stamp === "1",
  });

  return (
    <>
      {autoprint !== "0" && <PrintBackLink href="/reports/raw-material-shortage" />}
      <div className="print-rms">
        <style dangerouslySetInnerHTML={{ __html: printStyles("print-rms") }} />

        <PrintWatermark logoUrl={logoUrl} />

        <div className="hdr">
          <PrintLogoBlock company={company} logoUrl={logoUrl} showPhone={phone === "1"} showEmail={email === "1"} />
          <div style={{ textAlign: "right" }}>
            <h1>RAW MATERIAL SHORTAGE</h1>
            <div className="muted">As of {new Date().toISOString().slice(0, 10)}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">Shortfall Qty</th>
              <th>Blocked Jobs</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.itemId}>
                <td>
                  {r.item?.item_code} — {r.item?.description}
                </td>
                <td className="num">
                  {r.shortfall.toFixed(3)} {r.unit ?? r.item?.base_unit}
                </td>
                <td>{r.jobList}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={3} style={{ textAlign: "center" }}>
                  No raw material shortage.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="totals">
          <span className="grand">Items Short: {rows.length}</span>
        </div>

        <PrintSignoff ourLabel="Prepared By (Store)" theirLabel="Verified By (Owner)" signatureUrl={signatureUrl} stampUrl={stampUrl} />

        <PrintFooter />

        <script dangerouslySetInnerHTML={{ __html: AUTO_PRINT_SCRIPT }} />
      </div>
    </>
  );
}
