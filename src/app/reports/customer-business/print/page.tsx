import { createClient } from "@/lib/supabase/server";
import { printStyles, AUTO_PRINT_SCRIPT } from "@/lib/printStyles";
import { getCompanyBrandingUrls } from "@/lib/companyBranding";
import { PrintLogoBlock } from "@/components/PrintLogoBlock";
import { PrintFooter } from "@/components/PrintFooter";
import { PrintWatermark } from "@/components/PrintWatermark";
import { PrintSignoff } from "@/components/PrintSignoff";
import { PrintBackLink } from "@/components/PrintBackLink";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Customer-wise Business Report" };

export default async function CustomerBusinessPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ signature?: string; stamp?: string; phone?: string; email?: string; autoprint?: string }>;
}) {
  const { signature, stamp, phone, email, autoprint } = await searchParams;

  const supabase = await createClient();
  const [{ data: business }, { data: company }] = await Promise.all([
    supabase.rpc("fn_customer_business"),
    supabase.from("company").select("*").maybeSingle(),
  ]);

  const rows = (business ?? []).map((r) => ({
    id: r.party_id,
    name: r.name,
    orderCount: r.order_count,
    orderValue: r.order_value,
    invoiced: r.invoiced,
    outstanding: r.outstanding,
    lastOrder: r.last_order_date,
  }));

  const grandTotalOrders = rows.reduce((s, r) => s + r.orderValue, 0);
  const grandTotalInvoiced = rows.reduce((s, r) => s + r.invoiced, 0);
  const grandTotalOutstanding = rows.reduce((s, r) => s + r.outstanding, 0);

  const { logoUrl, signatureUrl, stampUrl } = await getCompanyBrandingUrls(supabase, company, {
    signature: signature === "1",
    stamp: stamp === "1",
  });

  return (
    <>
      {autoprint !== "0" && <PrintBackLink href="/reports/customer-business" />}
      <div className="print-cbiz">
        <style dangerouslySetInnerHTML={{ __html: printStyles("print-cbiz") }} />

        <PrintWatermark logoUrl={logoUrl} />

        <div className="hdr">
          <PrintLogoBlock company={company} logoUrl={logoUrl} showPhone={phone === "1"} showEmail={email === "1"} />
          <div style={{ textAlign: "right" }}>
            <h1>CUSTOMER-WISE BUSINESS REPORT</h1>
            <div className="muted">As of {new Date().toISOString().slice(0, 10)}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th className="num"># Orders</th>
              <th className="num">Order Value</th>
              <th className="num">Invoiced</th>
              <th className="num">Outstanding</th>
              <th>Last Order</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td className="num">{r.orderCount}</td>
                <td className="num">{r.orderValue.toLocaleString()}</td>
                <td className="num">{r.invoiced.toLocaleString()}</td>
                <td className="num">{r.outstanding.toLocaleString()}</td>
                <td>{r.lastOrder ? new Date(r.lastOrder).toISOString().slice(0, 10) : "—"}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={6} style={{ textAlign: "center" }}>
                  No client business data found.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="totals">
          <span>Total Order Value: {grandTotalOrders.toLocaleString()}</span>
          <span>Total Invoiced: {grandTotalInvoiced.toLocaleString()}</span>
          <span className="grand">Total Outstanding: {grandTotalOutstanding.toLocaleString()}</span>
        </div>

        <PrintSignoff ourLabel="Prepared By (Accounts)" theirLabel="Verified By (Owner)" signatureUrl={signatureUrl} stampUrl={stampUrl} />

        <PrintFooter />

        <script dangerouslySetInnerHTML={{ __html: AUTO_PRINT_SCRIPT }} />
      </div>
    </>
  );
}
