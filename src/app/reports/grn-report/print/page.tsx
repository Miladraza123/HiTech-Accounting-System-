import { createClient } from "@/lib/supabase/server";
import { printStyles, AUTO_PRINT_SCRIPT } from "@/lib/printStyles";
import { getCompanyBrandingUrls } from "@/lib/companyBranding";
import { PrintLogoBlock } from "@/components/PrintLogoBlock";
import { PrintFooter } from "@/components/PrintFooter";
import { PrintWatermark } from "@/components/PrintWatermark";
import { PrintSignoff } from "@/components/PrintSignoff";
import { PrintBackLink } from "@/components/PrintBackLink";
import type { Metadata } from "next";

function defaultMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { from, to };
}

export const metadata: Metadata = { title: "GRN / Receiving Report" };

export default async function GrnReportPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; signature?: string; stamp?: string; phone?: string; email?: string; autoprint?: string }>;
}) {
  const { from, to, signature, stamp, phone, email, autoprint } = await searchParams;
  const defaults = defaultMonthRange();
  const fromDate = from || defaults.from;
  const toDate = to || defaults.to;

  const supabase = await createClient();
  const [{ data: grns }, { data: company }] = await Promise.all([
    supabase
      .from("grns")
      .select("*, parties(legal_name), purchase_orders(po_no), warehouses(name), grn_lines(short_excess_qty, this_receipt_qty)")
      .gte("received_date", fromDate)
      .lte("received_date", toDate)
      .order("received_date", { ascending: false }),
    supabase.from("company").select("*").maybeSingle(),
  ]);

  type Line = { short_excess_qty: number; this_receipt_qty: number };
  const rows = (grns ?? []).map((g) => {
    const lines = g.grn_lines as unknown as Line[];
    const totalReceived = lines.reduce((s, l) => s + l.this_receipt_qty, 0);
    const totalShortExcess = lines.reduce((s, l) => s + l.short_excess_qty, 0);
    return {
      grn_no: g.grn_no,
      supplier: (g.parties as unknown as { legal_name: string } | null)?.legal_name ?? "—",
      po_no: (g.purchase_orders as unknown as { po_no: string } | null)?.po_no ?? "—",
      warehouse: (g.warehouses as unknown as { name: string } | null)?.name ?? "—",
      received_date: g.received_date,
      totalReceived,
      totalShortExcess,
    };
  });

  const totalGrns = rows.length;
  const totalShort = rows.filter((r) => r.totalShortExcess < 0).length;
  const totalExcess = rows.filter((r) => r.totalShortExcess > 0).length;

  const { logoUrl, signatureUrl, stampUrl } = await getCompanyBrandingUrls(supabase, company, {
    signature: signature === "1",
    stamp: stamp === "1",
  });

  return (
    <>
      {autoprint !== "0" && <PrintBackLink href={`/reports/grn-report?from=${fromDate}&to=${toDate}`} />}
      <div className="print-grn">
        <style dangerouslySetInnerHTML={{ __html: printStyles("print-grn") }} />

        <PrintWatermark logoUrl={logoUrl} />

        <div className="hdr">
          <PrintLogoBlock company={company} logoUrl={logoUrl} showPhone={phone === "1"} showEmail={email === "1"} />
          <div style={{ textAlign: "right" }}>
            <h1>GRN / RECEIVING REPORT</h1>
            <div className="muted">
              {fromDate} — {toDate}
            </div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>GRN #</th>
              <th>Supplier</th>
              <th>PO #</th>
              <th>Warehouse</th>
              <th>Date</th>
              <th className="num">Received</th>
              <th className="num">Short/Excess</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.grn_no}</td>
                <td>{r.supplier}</td>
                <td>{r.po_no}</td>
                <td>{r.warehouse}</td>
                <td>{r.received_date}</td>
                <td className="num">{r.totalReceived.toFixed(3)}</td>
                <td className="num">
                  {r.totalShortExcess !== 0 ? `${r.totalShortExcess > 0 ? "+" : ""}${r.totalShortExcess.toFixed(3)}` : "—"}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center" }}>
                  No GRNs found for this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="totals">
          <span>Total GRNs: {totalGrns}</span>
          <span>With Shortage: {totalShort}</span>
          <span className="grand">With Excess: {totalExcess}</span>
        </div>

        <PrintSignoff ourLabel="Prepared By (Store)" theirLabel="Verified By (Owner)" signatureUrl={signatureUrl} stampUrl={stampUrl} />

        <PrintFooter />

        <script dangerouslySetInnerHTML={{ __html: AUTO_PRINT_SCRIPT }} />
      </div>
    </>
  );
}
