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

// No pagination here, unlike the on-screen report — a printed statement
// must show the party's whole ledger, not just one page of it.
const PRINT_LIMIT = 100000;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ party_id?: string }>;
}): Promise<Metadata> {
  const { party_id } = await searchParams;
  if (!party_id) return { title: "Party Ledger" };
  const supabase = await createClient();
  const { data: party } = await supabase.from("parties").select("legal_name").eq("id", party_id).maybeSingle();
  return { title: party ? `Statement — ${party.legal_name}` : "Party Ledger" };
}

export default async function PartyLedgerPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ party_id?: string; signature?: string; stamp?: string; phone?: string; email?: string; autoprint?: string }>;
}) {
  const { party_id, signature, stamp, phone, email, autoprint } = await searchParams;
  if (!party_id) notFound();

  const supabase = await createClient();
  const [{ data: party }, { data: company }, { data: ledger }] = await Promise.all([
    supabase.from("parties").select("legal_name, billing_address, ntn, strn, party_type").eq("id", party_id).maybeSingle(),
    supabase.from("company").select("*").maybeSingle(),
    supabase.rpc("fn_party_ledger", { p_party_id: party_id, p_limit: PRINT_LIMIT, p_offset: 0 }),
  ]);

  if (!party) notFound();

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
      {autoprint !== "0" && <PrintBackLink href={`/reports/party-ledger?party_id=${party_id}`} />}
      <div className="print-pl">
        <style dangerouslySetInnerHTML={{ __html: printStyles("print-pl") }} />

        <PrintWatermark logoUrl={logoUrl} />

        <div className="hdr">
          <PrintLogoBlock company={company} logoUrl={logoUrl} showPhone={phone === "1"} showEmail={email === "1"} />
          <div style={{ textAlign: "right" }}>
            <h1>CUSTOMER / SUPPLIER STATEMENT OF ACCOUNT</h1>
            <div className="muted">As of {new Date().toISOString().slice(0, 10)}</div>
          </div>
        </div>

        <div style={{ fontSize: 13, marginBottom: 8 }}>
          <div className="muted">Statement For</div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{party.legal_name}</div>
          {party.billing_address && <div className="muted">{party.billing_address}</div>}
          <div className="muted">
            {party.ntn && <>NTN: {party.ntn} </>}
            {party.strn && <>STRN: {party.strn}</>}
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
                  No ledger entries for this party.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="totals">
          <span>Total Dr: {totalDebit.toLocaleString()}</span>
          <span>Total Cr: {totalCredit.toLocaleString()}</span>
          <span className="grand">Closing Balance: {closing.toLocaleString()}</span>
        </div>

        <PrintSignoff ourLabel="Prepared By (Accounts)" theirLabel="Received / Verified By (Client)" signatureUrl={signatureUrl} stampUrl={stampUrl} />

        <PrintFooter />

        <script dangerouslySetInnerHTML={{ __html: AUTO_PRINT_SCRIPT }} />
      </div>
    </>
  );
}
