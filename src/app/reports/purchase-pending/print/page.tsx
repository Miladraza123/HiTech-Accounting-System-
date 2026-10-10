import { createClient } from "@/lib/supabase/server";
import { printStyles, AUTO_PRINT_SCRIPT } from "@/lib/printStyles";
import { getCompanyBrandingUrls } from "@/lib/companyBranding";
import { PrintLogoBlock } from "@/components/PrintLogoBlock";
import { PrintFooter } from "@/components/PrintFooter";
import { PrintWatermark } from "@/components/PrintWatermark";
import { PrintSignoff } from "@/components/PrintSignoff";
import { PrintBackLink } from "@/components/PrintBackLink";
import type { Metadata } from "next";

// No pagination here, unlike the on-screen report — a printed report must
// show every pending purchase line, not just one page of it.
const PRINT_LIMIT = 100000;

export const metadata: Metadata = { title: "Purchase Pending Report" };

export default async function PurchasePendingPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ signature?: string; stamp?: string; phone?: string; email?: string; autoprint?: string }>;
}) {
  const { signature, stamp, phone, email, autoprint } = await searchParams;

  const supabase = await createClient();
  const [{ data: pending }, { data: company }] = await Promise.all([
    supabase.rpc("fn_purchase_pending", { p_limit: PRINT_LIMIT, p_offset: 0 }),
    supabase.from("company").select("*").maybeSingle(),
  ]);

  const rows = (pending ?? []).map((r) => ({
    po_no: r.po_no,
    supplier: r.supplier,
    expected: r.expected,
    description: r.description,
    ordered: r.ordered,
    received: r.received,
    pending: r.pending,
    unit: r.unit,
    overdueDays: r.overdue_days,
  }));

  const { logoUrl, signatureUrl, stampUrl } = await getCompanyBrandingUrls(supabase, company, {
    signature: signature === "1",
    stamp: stamp === "1",
  });

  return (
    <>
      {autoprint !== "0" && <PrintBackLink href="/reports/purchase-pending" />}
      <div className="print-pp">
        <style dangerouslySetInnerHTML={{ __html: printStyles("print-pp") }} />

        <PrintWatermark logoUrl={logoUrl} />

        <div className="hdr">
          <PrintLogoBlock company={company} logoUrl={logoUrl} showPhone={phone === "1"} showEmail={email === "1"} />
          <div style={{ textAlign: "right" }}>
            <h1>PURCHASE PENDING REPORT</h1>
            <div className="muted">As of {new Date().toISOString().slice(0, 10)}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>PO #</th>
              <th>Supplier</th>
              <th>Description</th>
              <th className="num">Ordered</th>
              <th className="num">Received</th>
              <th className="num">Pending</th>
              <th>Expected</th>
              <th className="num">Overdue (days)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.po_no}</td>
                <td>{r.supplier}</td>
                <td>{r.description}</td>
                <td className="num">
                  {r.ordered} {r.unit}
                </td>
                <td className="num">{r.received}</td>
                <td className="num">{r.pending.toFixed(3)}</td>
                <td>{r.expected ?? "—"}</td>
                <td className="num">{r.overdueDays !== null && r.overdueDays > 0 ? r.overdueDays : "—"}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={8} style={{ textAlign: "center" }}>
                  No pending purchases — everything has been received.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="totals">
          <span className="grand">Pending Lines: {rows.length}</span>
        </div>

        <PrintSignoff ourLabel="Prepared By (Store)" theirLabel="Verified By (Owner)" signatureUrl={signatureUrl} stampUrl={stampUrl} />

        <PrintFooter />

        <script dangerouslySetInnerHTML={{ __html: AUTO_PRINT_SCRIPT }} />
      </div>
    </>
  );
}
