import { createClient } from "@/lib/supabase/server";
import { printStyles, AUTO_PRINT_SCRIPT } from "@/lib/printStyles";
import { getCompanyBrandingUrls } from "@/lib/companyBranding";
import { PrintLogoBlock } from "@/components/PrintLogoBlock";
import { PrintFooter } from "@/components/PrintFooter";
import { PrintWatermark } from "@/components/PrintWatermark";
import { PrintSignoff } from "@/components/PrintSignoff";
import { PrintBackLink } from "@/components/PrintBackLink";
import type { Metadata } from "next";

function defaultFyRange(): { from: string; to: string } {
  const now = new Date();
  const fyStartYear = now.getMonth() + 1 >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return { from: `${fyStartYear}-07-01`, to: `${fyStartYear + 1}-06-30` };
}

export const metadata: Metadata = { title: "Profit & Loss Statement" };

export default async function ProfitLossPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; signature?: string; stamp?: string; phone?: string; email?: string; autoprint?: string }>;
}) {
  const { from, to, signature, stamp, phone, email, autoprint } = await searchParams;
  const defaults = defaultFyRange();
  const fromDate = from || defaults.from;
  const toDate = to || defaults.to;

  const supabase = await createClient();
  const [{ data: accounts }, { data: company }] = await Promise.all([
    supabase.rpc("fn_profit_loss", { p_from: fromDate, p_to: toDate }),
    supabase.from("company").select("*").maybeSingle(),
  ]);

  const { logoUrl, signatureUrl, stampUrl } = await getCompanyBrandingUrls(supabase, company, {
    signature: signature === "1",
    stamp: stamp === "1",
  });

  const byCode = (accounts ?? []).slice().sort((a, b) => a.code.localeCompare(b.code));

  const revenueRows = byCode.filter((a) => a.account_type === "income").map((a) => ({ code: a.code, name: a.name, amount: -a.net }));
  const cogsRows = byCode.filter((a) => a.code === "5000" || a.code === "5010").map((a) => ({ code: a.code, name: a.name, amount: a.net }));
  const opexRows = byCode
    .filter((a) => a.account_type === "expense" && a.code !== "5000" && a.code !== "5010")
    .map((a) => ({ code: a.code, name: a.name, amount: a.net }));

  const totalRevenue = revenueRows.reduce((s, r) => s + r.amount, 0);
  const totalCogs = cogsRows.reduce((s, r) => s + r.amount, 0);
  const grossProfit = totalRevenue - totalCogs;
  const totalOpex = opexRows.reduce((s, r) => s + r.amount, 0);
  const netProfit = grossProfit - totalOpex;

  return (
    <>
      {autoprint !== "0" && <PrintBackLink href={`/reports/profit-loss?from=${fromDate}&to=${toDate}`} />}
      <div className="print-profloss">
        <style dangerouslySetInnerHTML={{ __html: printStyles("print-profloss") }} />

        <PrintWatermark logoUrl={logoUrl} />

        <div className="hdr">
          <PrintLogoBlock company={company} logoUrl={logoUrl} showPhone={phone === "1"} showEmail={email === "1"} />
          <div style={{ textAlign: "right" }}>
            <h1>PROFIT &amp; LOSS STATEMENT</h1>
            <div className="muted">
              {fromDate} — {toDate}
            </div>
          </div>
        </div>

        <table>
          <tbody>
            <tr>
              <th colSpan={2}>Revenue</th>
            </tr>
            {revenueRows.map((r) => (
              <tr key={r.code}>
                <td style={{ paddingLeft: 20 }}>{r.name}</td>
                <td className="num">{r.amount.toLocaleString()}</td>
              </tr>
            ))}
            <tr>
              <td style={{ fontWeight: 600 }}>Total Revenue</td>
              <td className="num" style={{ fontWeight: 600 }}>
                {totalRevenue.toLocaleString()}
              </td>
            </tr>

            <tr>
              <th colSpan={2}>Cost of Goods Sold</th>
            </tr>
            {cogsRows.map((r) => (
              <tr key={r.code}>
                <td style={{ paddingLeft: 20 }}>{r.name}</td>
                <td className="num">{r.amount.toLocaleString()}</td>
              </tr>
            ))}
            <tr>
              <td style={{ fontWeight: 600 }}>Total COGS</td>
              <td className="num" style={{ fontWeight: 600 }}>
                {totalCogs.toLocaleString()}
              </td>
            </tr>

            <tr>
              <td style={{ fontWeight: 700 }}>Gross Profit</td>
              <td className="num" style={{ fontWeight: 700 }}>
                {grossProfit.toLocaleString()}
              </td>
            </tr>

            <tr>
              <th colSpan={2}>Operating Expenses</th>
            </tr>
            {opexRows.map((r) => (
              <tr key={r.code}>
                <td style={{ paddingLeft: 20 }}>{r.name}</td>
                <td className="num">{r.amount.toLocaleString()}</td>
              </tr>
            ))}
            <tr>
              <td style={{ fontWeight: 600 }}>Total Operating Expenses</td>
              <td className="num" style={{ fontWeight: 600 }}>
                {totalOpex.toLocaleString()}
              </td>
            </tr>

            <tr>
              <td style={{ fontWeight: 700 }}>Net Profit / (Loss)</td>
              <td className="num" style={{ fontWeight: 700 }}>
                {netProfit.toLocaleString()}
              </td>
            </tr>
          </tbody>
        </table>

        <PrintSignoff ourLabel="Prepared By (Accounts)" theirLabel="Verified By (Owner)" signatureUrl={signatureUrl} stampUrl={stampUrl} />

        <PrintFooter />

        <script dangerouslySetInnerHTML={{ __html: AUTO_PRINT_SCRIPT }} />
      </div>
    </>
  );
}
