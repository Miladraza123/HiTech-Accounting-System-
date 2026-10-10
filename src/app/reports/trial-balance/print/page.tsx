import { createClient } from "@/lib/supabase/server";
import { printStyles, AUTO_PRINT_SCRIPT } from "@/lib/printStyles";
import { getCompanyBrandingUrls } from "@/lib/companyBranding";
import { PrintLogoBlock } from "@/components/PrintLogoBlock";
import { PrintFooter } from "@/components/PrintFooter";
import { PrintWatermark } from "@/components/PrintWatermark";
import { PrintSignoff } from "@/components/PrintSignoff";
import { PrintBackLink } from "@/components/PrintBackLink";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Trial Balance" };

export default async function TrialBalancePrintPage({
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

  const active = (rows ?? []).filter((r) => (r.total_debit ?? 0) !== 0 || (r.total_credit ?? 0) !== 0);
  const totalDebit = active.reduce((s, r) => s + (r.total_debit ?? 0), 0);
  const totalCredit = active.reduce((s, r) => s + (r.total_credit ?? 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

  return (
    <>
      {autoprint !== "0" && <PrintBackLink href="/reports/trial-balance" />}
      <div className="print-tb">
        <style dangerouslySetInnerHTML={{ __html: printStyles("print-tb") }} />

        <PrintWatermark logoUrl={logoUrl} />

        <div className="hdr">
          <PrintLogoBlock company={company} logoUrl={logoUrl} showPhone={phone === "1"} showEmail={email === "1"} />
          <div style={{ textAlign: "right" }}>
            <h1>TRIAL BALANCE</h1>
            <div className="muted">As of {new Date().toISOString().slice(0, 10)}</div>
          </div>
        </div>

        {!balanced && (
          <div style={{ marginBottom: 8, fontSize: 12, color: "#B3261E" }}>
            Trial Balance is not balanced (Debit {totalDebit.toLocaleString()} ≠ Credit {totalCredit.toLocaleString()}).
          </div>
        )}

        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Account</th>
              <th>Type</th>
              <th className="num">Debit</th>
              <th className="num">Credit</th>
              <th className="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            {active.map((r) => {
              const balance = r.balance ?? 0;
              return (
                <tr key={r.account_id}>
                  <td>{r.code}</td>
                  <td>{r.name}</td>
                  <td className="muted" style={{ textTransform: "capitalize" }}>
                    {r.account_type}
                  </td>
                  <td className="num">{(r.total_debit ?? 0).toLocaleString()}</td>
                  <td className="num">{(r.total_credit ?? 0).toLocaleString()}</td>
                  <td className="num" style={{ fontWeight: 600 }}>
                    {Math.abs(balance).toLocaleString()} {balance >= 0 ? "Dr" : "Cr"}
                  </td>
                </tr>
              );
            })}
            {!active.length && (
              <tr>
                <td colSpan={6} style={{ textAlign: "center" }}>
                  No posted journal entries yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="totals">
          <span>Total Debit: {totalDebit.toLocaleString()}</span>
          <span className="grand">Total Credit: {totalCredit.toLocaleString()}</span>
        </div>

        <PrintSignoff ourLabel="Prepared By (Accounts)" theirLabel="Verified By (Owner)" signatureUrl={signatureUrl} stampUrl={stampUrl} />

        <PrintFooter />

        <script dangerouslySetInnerHTML={{ __html: AUTO_PRINT_SCRIPT }} />
      </div>
    </>
  );
}
