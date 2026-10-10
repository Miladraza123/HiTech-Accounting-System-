import { createClient } from "@/lib/supabase/server";
import { printStyles, AUTO_PRINT_SCRIPT } from "@/lib/printStyles";
import { getCompanyBrandingUrls } from "@/lib/companyBranding";
import { PrintLogoBlock } from "@/components/PrintLogoBlock";
import { PrintFooter } from "@/components/PrintFooter";
import { PrintWatermark } from "@/components/PrintWatermark";
import { PrintSignoff } from "@/components/PrintSignoff";
import { PrintBackLink } from "@/components/PrintBackLink";
import type { Metadata } from "next";

// No pagination here, unlike the on-screen report — a printed copy must
// show every pending line, not just one page of it.
const PRINT_LIMIT = 100000;

export const metadata: Metadata = { title: "Pending Order & Delivery Report" };

export default async function PendingOrdersPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ signature?: string; stamp?: string; phone?: string; email?: string; autoprint?: string }>;
}) {
  const { signature, stamp, phone, email, autoprint } = await searchParams;

  const supabase = await createClient();
  const [{ data: pending }, { data: company }] = await Promise.all([
    supabase.rpc("fn_pending_orders", { p_limit: PRINT_LIMIT, p_offset: 0 }),
    supabase.from("company").select("*").maybeSingle(),
  ]);

  const { logoUrl, signatureUrl, stampUrl } = await getCompanyBrandingUrls(supabase, company, {
    signature: signature === "1",
    stamp: stamp === "1",
  });

  const rows = (pending ?? []).map((r) => ({
    so_no: r.so_no,
    client: r.client,
    description: r.description,
    ordered: r.ordered,
    pendingDeliver: r.pending_deliver,
    pendingInvoice: r.pending_invoice,
    unit: r.unit,
    days: r.days,
  }));

  const totalRows = pending?.[0]?.total_rows ?? 0;
  const totalPendingDeliverValue = pending?.[0]?.total_pending_deliver ?? 0;

  return (
    <>
      {autoprint !== "0" && <PrintBackLink href="/reports/pending-orders" />}
      <div className="print-pend">
        <style dangerouslySetInnerHTML={{ __html: printStyles("print-pend") }} />

        <PrintWatermark logoUrl={logoUrl} />

        <div className="hdr">
          <PrintLogoBlock company={company} logoUrl={logoUrl} showPhone={phone === "1"} showEmail={email === "1"} />
          <div style={{ textAlign: "right" }}>
            <h1>PENDING ORDER &amp; DELIVERY REPORT</h1>
            <div className="muted">As of {new Date().toISOString().slice(0, 10)}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>SO #</th>
              <th>Client</th>
              <th>Description</th>
              <th className="num">Ordered</th>
              <th className="num">Pending Deliver</th>
              <th className="num">Pending Invoice</th>
              <th className="num">Days Since PO</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.so_no}</td>
                <td>{r.client}</td>
                <td>{r.description}</td>
                <td className="num">
                  {r.ordered} {r.unit}
                </td>
                <td className="num">{r.pendingDeliver > 0.001 ? r.pendingDeliver.toFixed(3) : "—"}</td>
                <td className="num">{r.pendingInvoice > 0.001 ? r.pendingInvoice.toFixed(3) : "—"}</td>
                <td className="num">{r.days}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center" }}>
                  No pending orders or deliveries — everything is up to date.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="totals">
          <span>Pending Lines: {totalRows}</span>
          <span className="grand">Total Pending-to-Deliver Qty: {totalPendingDeliverValue.toFixed(2)}</span>
        </div>

        <PrintSignoff ourLabel="Prepared By (Accounts)" theirLabel="Verified By (Owner)" signatureUrl={signatureUrl} stampUrl={stampUrl} />

        <PrintFooter />

        <script dangerouslySetInnerHTML={{ __html: AUTO_PRINT_SCRIPT }} />
      </div>
    </>
  );
}
