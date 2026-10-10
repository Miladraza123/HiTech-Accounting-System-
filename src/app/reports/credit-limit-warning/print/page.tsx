import { createClient } from "@/lib/supabase/server";
import { printStyles, AUTO_PRINT_SCRIPT } from "@/lib/printStyles";
import { getCompanyBrandingUrls } from "@/lib/companyBranding";
import { PrintLogoBlock } from "@/components/PrintLogoBlock";
import { PrintFooter } from "@/components/PrintFooter";
import { PrintWatermark } from "@/components/PrintWatermark";
import { PrintSignoff } from "@/components/PrintSignoff";
import { PrintBackLink } from "@/components/PrintBackLink";
import type { Metadata } from "next";

// A client is flagged once outstanding crosses this fraction of their credit
// limit — same threshold as the on-screen report.
const WARNING_THRESHOLD = 0.9;

export const metadata: Metadata = { title: "Credit Limit Warning" };

export default async function CreditLimitWarningPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ signature?: string; stamp?: string; phone?: string; email?: string; autoprint?: string }>;
}) {
  const { signature, stamp, phone, email, autoprint } = await searchParams;

  const supabase = await createClient();
  const [{ data: parties }, { data: arSummary }, { data: company }] = await Promise.all([
    supabase.from("parties").select("id, legal_name, credit_limit, credit_days").in("party_type", ["client", "both"]).gt("credit_limit", 0),
    supabase.from("party_ar_summary").select("*"),
    supabase.from("company").select("*").maybeSingle(),
  ]);

  const outstandingById = new Map((arSummary ?? []).map((s) => [s.party_id, s.total_outstanding ?? 0]));

  const rows = (parties ?? [])
    .map((p) => {
      const outstanding = outstandingById.get(p.id) ?? 0;
      const pct = p.credit_limit > 0 ? outstanding / p.credit_limit : 0;
      return { ...p, outstanding, pct };
    })
    .filter((r) => r.pct >= WARNING_THRESHOLD)
    .sort((a, b) => b.pct - a.pct);

  const overLimitCount = rows.filter((r) => r.pct >= 1).length;
  const totalOutstanding = rows.reduce((s, r) => s + r.outstanding, 0);

  const { logoUrl, signatureUrl, stampUrl } = await getCompanyBrandingUrls(supabase, company, {
    signature: signature === "1",
    stamp: stamp === "1",
  });

  return (
    <>
      {autoprint !== "0" && <PrintBackLink href="/reports/credit-limit-warning" />}
      <div className="print-clw">
        <style dangerouslySetInnerHTML={{ __html: printStyles("print-clw") }} />

        <PrintWatermark logoUrl={logoUrl} />

        <div className="hdr">
          <PrintLogoBlock company={company} logoUrl={logoUrl} showPhone={phone === "1"} showEmail={email === "1"} />
          <div style={{ textAlign: "right" }}>
            <h1>CREDIT LIMIT WARNING</h1>
            <div className="muted">Clients at 90% or more of Credit Limit</div>
            <div className="muted">As of {new Date().toISOString().slice(0, 10)}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th className="num">Credit Limit</th>
              <th className="num">Outstanding</th>
              <th className="num">% Used</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.legal_name}</td>
                <td className="num">{r.credit_limit.toLocaleString()}</td>
                <td className="num">{r.outstanding.toLocaleString()}</td>
                <td className="num">{Math.round(r.pct * 100)}%</td>
                <td>{r.pct >= 1 ? "Over Limit" : "Warning"}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} style={{ textAlign: "center" }}>
                  No client is near or over their Credit Limit.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="totals">
          <span>Clients Near/Over Limit: {rows.length}</span>
          <span>Clients Over Limit: {overLimitCount}</span>
          <span className="grand">Total Outstanding: {totalOutstanding.toLocaleString()}</span>
        </div>

        <PrintSignoff ourLabel="Prepared By (Accounts)" theirLabel="Verified By (Owner)" signatureUrl={signatureUrl} stampUrl={stampUrl} />

        <PrintFooter />

        <script dangerouslySetInnerHTML={{ __html: AUTO_PRINT_SCRIPT }} />
      </div>
    </>
  );
}
