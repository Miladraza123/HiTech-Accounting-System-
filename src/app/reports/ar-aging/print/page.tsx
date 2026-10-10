import { createClient } from "@/lib/supabase/server";
import { printStyles, AUTO_PRINT_SCRIPT } from "@/lib/printStyles";
import { getCompanyBrandingUrls } from "@/lib/companyBranding";
import { PrintLogoBlock } from "@/components/PrintLogoBlock";
import { PrintFooter } from "@/components/PrintFooter";
import { PrintWatermark } from "@/components/PrintWatermark";
import { PrintSignoff } from "@/components/PrintSignoff";
import { PrintBackLink } from "@/components/PrintBackLink";
import { asAgingRows } from "@/lib/aging";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "AR Aging — Client-wise Outstanding" };

export default async function ArAgingPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ signature?: string; stamp?: string; phone?: string; email?: string; autoprint?: string }>;
}) {
  const { signature, stamp, phone, email, autoprint } = await searchParams;

  const supabase = await createClient();
  // Same fn_ar_aging RPC the screen uses — it already returns one bounded
  // row per client, so there is no pagination to widen here.
  const [{ data: aged }, { data: company }] = await Promise.all([
    supabase.rpc("fn_ar_aging"),
    supabase.from("company").select("*").maybeSingle(),
  ]);

  const { logoUrl, signatureUrl, stampUrl } = await getCompanyBrandingUrls(supabase, company, {
    signature: signature === "1",
    stamp: stamp === "1",
  });

  const rows = asAgingRows(aged).map((r) => ({
    partyId: r.party_id,
    name: r.name ?? "—",
    current: r.bucket_current,
    d1_30: r.bucket_1_30,
    d31_60: r.bucket_31_60,
    d61_90: r.bucket_61_90,
    d90_plus: r.bucket_90_plus,
    total: r.total,
    opening: r.opening_balance,
    unapplied: r.unapplied,
    net: r.net,
  }));

  const grand = rows.reduce(
    (acc, r) => ({
      current: acc.current + r.current,
      d1_30: acc.d1_30 + r.d1_30,
      d31_60: acc.d31_60 + r.d31_60,
      d61_90: acc.d61_90 + r.d61_90,
      d90_plus: acc.d90_plus + r.d90_plus,
      total: acc.total + r.total,
      opening: acc.opening + r.opening,
      unapplied: acc.unapplied + r.unapplied,
      net: acc.net + r.net,
    }),
    { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0, opening: 0, unapplied: 0, net: 0 }
  );

  return (
    <>
      {autoprint !== "0" && <PrintBackLink href="/reports/ar-aging" />}
      <div className="print-ara">
        <style dangerouslySetInnerHTML={{ __html: printStyles("print-ara") }} />

        <PrintWatermark logoUrl={logoUrl} />

        <div className="hdr">
          <PrintLogoBlock company={company} logoUrl={logoUrl} showPhone={phone === "1"} showEmail={email === "1"} />
          <div style={{ textAlign: "right" }}>
            <h1>AR AGING — CLIENT-WISE OUTSTANDING</h1>
            <div className="muted">As of {new Date().toISOString().slice(0, 10)}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th className="num">Current</th>
              <th className="num">1-30</th>
              <th className="num">31-60</th>
              <th className="num">61-90</th>
              <th className="num">90+</th>
              <th className="num">Total</th>
              <th className="num">Opening / Adj.</th>
              <th className="num">Unapplied</th>
              <th className="num">Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.partyId}>
                <td>{r.name}</td>
                <td className="num">{r.current.toLocaleString()}</td>
                <td className="num">{r.d1_30.toLocaleString()}</td>
                <td className="num">{r.d31_60.toLocaleString()}</td>
                <td className="num">{r.d61_90.toLocaleString()}</td>
                <td className="num">{r.d90_plus.toLocaleString()}</td>
                <td className="num">{r.total.toLocaleString()}</td>
                <td className="num">{r.opening.toLocaleString()}</td>
                <td className="num">{r.unapplied.toLocaleString()}</td>
                <td className="num">{r.net.toLocaleString()}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={10} style={{ textAlign: "center" }}>
                  No outstanding balances.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="totals">
          <span>Total: {grand.total.toLocaleString()}</span>
          <span>Opening / Adj.: {grand.opening.toLocaleString()}</span>
          <span>Unapplied: {grand.unapplied.toLocaleString()}</span>
          <span className="grand">Net: {grand.net.toLocaleString()}</span>
        </div>

        <PrintSignoff ourLabel="Prepared By (Accounts)" theirLabel="Verified By (Owner)" signatureUrl={signatureUrl} stampUrl={stampUrl} />

        <PrintFooter />

        <script dangerouslySetInnerHTML={{ __html: AUTO_PRINT_SCRIPT }} />
      </div>
    </>
  );
}
