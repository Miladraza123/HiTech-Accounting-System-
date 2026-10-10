import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { printStyles, AUTO_PRINT_SCRIPT } from "@/lib/printStyles";
import { getCompanyBrandingUrls } from "@/lib/companyBranding";
import { PrintLogoBlock } from "@/components/PrintLogoBlock";
import { PrintFooter } from "@/components/PrintFooter";
import { PrintWatermark } from "@/components/PrintWatermark";
import { PrintSignoff } from "@/components/PrintSignoff";
import { PrintBackLink } from "@/components/PrintBackLink";
import type { Metadata } from "next";

// No pagination here, unlike the on-screen report — a printed ledger must
// show the account's whole history, not just one page of it.
const PRINT_LIMIT = 100000;

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ code?: string }> }): Promise<Metadata> {
  const { code } = await searchParams;
  if (!code) return { title: "General Ledger" };
  const supabase = await createClient();
  const { data: account } = await supabase.from("chart_of_accounts").select("name").eq("code", code).maybeSingle();
  return { title: account ? `${code} — ${account.name}` : "General Ledger" };
}

export default async function GeneralLedgerPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; signature?: string; stamp?: string; phone?: string; email?: string; autoprint?: string }>;
}) {
  const { code, signature, stamp, phone, email, autoprint } = await searchParams;
  if (!code) notFound();

  const supabase = await createClient();
  const [{ data: account }, { data: company }] = await Promise.all([
    supabase.from("chart_of_accounts").select("id, code, name").eq("code", code).maybeSingle(),
    supabase.from("company").select("*").maybeSingle(),
  ]);
  if (!account) notFound();

  const { data: ledger } = await supabase.rpc("fn_account_ledger", { p_account_id: account.id, p_limit: PRINT_LIMIT, p_offset: 0 });

  const { logoUrl, signatureUrl, stampUrl } = await getCompanyBrandingUrls(supabase, company, {
    signature: signature === "1",
    stamp: stamp === "1",
  });

  const rows = ledger ?? [];
  const totalDebit = rows[0]?.total_debit ?? 0;
  const totalCredit = rows[0]?.total_credit ?? 0;
  const closing = totalDebit - totalCredit;

  return (
    <>
      {autoprint !== "0" && <PrintBackLink href={`/reports/general-ledger?code=${code}`} />}
      <div className="print-gl">
        <style dangerouslySetInnerHTML={{ __html: printStyles("print-gl") }} />

        <PrintWatermark logoUrl={logoUrl} />

        <div className="hdr">
          <PrintLogoBlock company={company} logoUrl={logoUrl} showPhone={phone === "1"} showEmail={email === "1"} />
          <div style={{ textAlign: "right" }}>
            <h1>GENERAL LEDGER</h1>
            <div className="muted">
              {account.code} — {account.name}
            </div>
            <div className="muted">As of {new Date().toISOString().slice(0, 10)}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Narration</th>
              <th className="num">Debit</th>
              <th className="num">Credit</th>
              <th className="num">Running Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.entry_date}</td>
                <td>
                  {r.narration}
                  {r.memo && <div className="muted">{r.memo}</div>}
                </td>
                <td className="num">{r.debit > 0 ? r.debit.toLocaleString() : ""}</td>
                <td className="num">{r.credit > 0 ? r.credit.toLocaleString() : ""}</td>
                <td className="num">{r.running.toLocaleString()}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} style={{ textAlign: "center" }}>
                  No entries for this account.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="totals">
          <span>Total Dr: {totalDebit.toLocaleString()}</span>
          <span>Total Cr: {totalCredit.toLocaleString()}</span>
          <span className="grand">Balance: {closing.toLocaleString()}</span>
        </div>

        <PrintSignoff ourLabel="Prepared By (Accounts)" theirLabel="Verified By (Owner)" signatureUrl={signatureUrl} stampUrl={stampUrl} />

        <PrintFooter />

        <script dangerouslySetInnerHTML={{ __html: AUTO_PRINT_SCRIPT }} />
      </div>
    </>
  );
}
