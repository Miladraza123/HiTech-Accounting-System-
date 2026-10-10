import { createClient } from "@/lib/supabase/server";
import { printStyles, AUTO_PRINT_SCRIPT } from "@/lib/printStyles";
import { getCompanyBrandingUrls } from "@/lib/companyBranding";
import { PrintLogoBlock } from "@/components/PrintLogoBlock";
import { PrintFooter } from "@/components/PrintFooter";
import { PrintWatermark } from "@/components/PrintWatermark";
import { PrintSignoff } from "@/components/PrintSignoff";
import { PrintBackLink } from "@/components/PrintBackLink";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Balance Sheet" };

export default async function BalanceSheetPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ signature?: string; stamp?: string; phone?: string; email?: string; autoprint?: string }>;
}) {
  const { signature, stamp, phone, email, autoprint } = await searchParams;

  const supabase = await createClient();
  const [{ data: rows }, { data: company }] = await Promise.all([
    supabase.from("trial_balance").select("*").order("code"),
    supabase.from("company").select("*").maybeSingle(),
  ]);

  const { logoUrl, signatureUrl, stampUrl } = await getCompanyBrandingUrls(supabase, company, {
    signature: signature === "1",
    stamp: stamp === "1",
  });

  const assetRows = (rows ?? []).filter((r) => r.account_type === "asset").map((r) => ({ code: r.code, name: r.name, amount: r.balance ?? 0 }));
  const liabilityRows = (rows ?? []).filter((r) => r.account_type === "liability").map((r) => ({ code: r.code, name: r.name, amount: -(r.balance ?? 0) }));
  const equityRows = (rows ?? []).filter((r) => r.account_type === "equity").map((r) => ({ code: r.code, name: r.name, amount: -(r.balance ?? 0) }));
  const incomeTotal = (rows ?? []).filter((r) => r.account_type === "income").reduce((s, r) => s - (r.balance ?? 0), 0);
  const expenseTotal = (rows ?? []).filter((r) => r.account_type === "expense").reduce((s, r) => s + (r.balance ?? 0), 0);
  const retainedEarnings = incomeTotal - expenseTotal;

  const totalAssets = assetRows.reduce((s, r) => s + r.amount, 0);
  const totalLiabilities = liabilityRows.reduce((s, r) => s + r.amount, 0);
  const totalEquityAccounts = equityRows.reduce((s, r) => s + r.amount, 0);
  const totalEquity = totalEquityAccounts + retainedEarnings;
  const difference = totalAssets - (totalLiabilities + totalEquity);
  const balanced = Math.round(difference * 100) === 0;

  return (
    <>
      {autoprint !== "0" && <PrintBackLink href="/reports/balance-sheet" />}
      <div className="print-bs">
        <style dangerouslySetInnerHTML={{ __html: printStyles("print-bs") }} />

        <PrintWatermark logoUrl={logoUrl} />

        <div className="hdr">
          <PrintLogoBlock company={company} logoUrl={logoUrl} showPhone={phone === "1"} showEmail={email === "1"} />
          <div style={{ textAlign: "right" }}>
            <h1>BALANCE SHEET</h1>
            <div className="muted">As of {new Date().toISOString().slice(0, 10)}</div>
          </div>
        </div>

        {!balanced && (
          <div style={{ marginBottom: 8, fontSize: 12, color: "#B3261E" }}>
            Balance Sheet is not balancing — difference: {difference.toLocaleString()}.
          </div>
        )}

        <table>
          <thead>
            <tr>
              <th colSpan={2}>Assets</th>
            </tr>
          </thead>
          <tbody>
            {assetRows.map((r) => (
              <tr key={r.code}>
                <td style={{ paddingLeft: 20 }}>{r.name}</td>
                <td className="num">{r.amount.toLocaleString()}</td>
              </tr>
            ))}
            <tr>
              <td style={{ fontWeight: 700 }}>Total Assets</td>
              <td className="num" style={{ fontWeight: 700 }}>
                {totalAssets.toLocaleString()}
              </td>
            </tr>
          </tbody>
        </table>

        <table>
          <thead>
            <tr>
              <th colSpan={2}>Liabilities</th>
            </tr>
          </thead>
          <tbody>
            {liabilityRows.map((r) => (
              <tr key={r.code}>
                <td style={{ paddingLeft: 20 }}>{r.name}</td>
                <td className="num">{r.amount.toLocaleString()}</td>
              </tr>
            ))}
            <tr>
              <td style={{ fontWeight: 700 }}>Total Liabilities</td>
              <td className="num" style={{ fontWeight: 700 }}>
                {totalLiabilities.toLocaleString()}
              </td>
            </tr>
          </tbody>
        </table>

        <table>
          <thead>
            <tr>
              <th colSpan={2}>Equity</th>
            </tr>
          </thead>
          <tbody>
            {equityRows.map((r) => (
              <tr key={r.code}>
                <td style={{ paddingLeft: 20 }}>{r.name}</td>
                <td className="num">{r.amount.toLocaleString()}</td>
              </tr>
            ))}
            <tr>
              <td style={{ paddingLeft: 20 }}>Retained Earnings (accumulated Net Profit — books never period-closed)</td>
              <td className="num">{retainedEarnings.toLocaleString()}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Total Equity</td>
              <td className="num" style={{ fontWeight: 700 }}>
                {totalEquity.toLocaleString()}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="totals">
          <span className="grand">Liabilities + Equity: {(totalLiabilities + totalEquity).toLocaleString()}</span>
        </div>

        <PrintSignoff ourLabel="Prepared By (Accounts)" theirLabel="Verified By (Owner)" signatureUrl={signatureUrl} stampUrl={stampUrl} />

        <PrintFooter />

        <script dangerouslySetInnerHTML={{ __html: AUTO_PRINT_SCRIPT }} />
      </div>
    </>
  );
}
