import { createClient } from "@/lib/supabase/server";
import { printStyles, AUTO_PRINT_SCRIPT } from "@/lib/printStyles";
import { getCompanyBrandingUrls } from "@/lib/companyBranding";
import { PrintLogoBlock } from "@/components/PrintLogoBlock";
import { PrintFooter } from "@/components/PrintFooter";
import { PrintWatermark } from "@/components/PrintWatermark";
import { PrintSignoff } from "@/components/PrintSignoff";
import { PrintBackLink } from "@/components/PrintBackLink";
import type { Metadata } from "next";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}): Promise<Metadata> {
  const { date } = await searchParams;
  const selectedDate = date || new Date().toISOString().slice(0, 10);
  return { title: `Daily Ledger — ${selectedDate}` };
}

export default async function DailyLedgerPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; signature?: string; stamp?: string; phone?: string; email?: string; autoprint?: string }>;
}) {
  const { date, signature, stamp, phone, email, autoprint } = await searchParams;
  const selectedDate = date || new Date().toISOString().slice(0, 10);

  const supabase = await createClient();
  const [{ data: entries }, { data: company }] = await Promise.all([
    supabase
      .from("journal_entries")
      .select("*, journal_lines(*, chart_of_accounts(code, name), parties(legal_name))")
      .eq("entry_date", selectedDate)
      .order("created_at"),
    supabase.from("company").select("*").maybeSingle(),
  ]);

  const { logoUrl, signatureUrl, stampUrl } = await getCompanyBrandingUrls(supabase, company, {
    signature: signature === "1",
    stamp: stamp === "1",
  });

  let dayDebit = 0;
  let dayCredit = 0;
  for (const e of entries ?? []) {
    const lines = e.journal_lines as unknown as { debit: number; credit: number }[];
    for (const l of lines) {
      dayDebit += l.debit;
      dayCredit += l.credit;
    }
  }

  return (
    <>
      {autoprint !== "0" && <PrintBackLink href={`/reports/daily-ledger?date=${selectedDate}`} />}
      <div className="print-dl">
        <style dangerouslySetInnerHTML={{ __html: printStyles("print-dl") }} />

        <PrintWatermark logoUrl={logoUrl} />

        <div className="hdr">
          <PrintLogoBlock company={company} logoUrl={logoUrl} showPhone={phone === "1"} showEmail={email === "1"} />
          <div style={{ textAlign: "right" }}>
            <h1>DAILY LEDGER / DAY BOOK</h1>
            <div className="muted">{selectedDate}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Entry #</th>
              <th>Narration</th>
              <th>Account</th>
              <th>Party</th>
              <th className="num">Debit</th>
              <th className="num">Credit</th>
            </tr>
          </thead>
          <tbody>
            {(entries ?? []).map((e) => {
              const lines = e.journal_lines as unknown as {
                id: string;
                debit: number;
                credit: number;
                memo: string | null;
                chart_of_accounts: { code: string; name: string } | null;
                parties: { legal_name: string } | null;
              }[];
              return lines.map((l, idx) => (
                <tr key={l.id}>
                  {idx === 0 && <td rowSpan={lines.length}>{e.entry_no}</td>}
                  {idx === 0 && <td rowSpan={lines.length}>{e.narration}</td>}
                  <td>
                    {l.chart_of_accounts?.code} — {l.chart_of_accounts?.name}
                    {l.memo && <div className="muted">{l.memo}</div>}
                  </td>
                  <td>{l.parties?.legal_name ?? "—"}</td>
                  <td className="num">{l.debit > 0 ? l.debit.toLocaleString() : ""}</td>
                  <td className="num">{l.credit > 0 ? l.credit.toLocaleString() : ""}</td>
                </tr>
              ));
            })}
            {!entries?.length && (
              <tr>
                <td colSpan={6} style={{ textAlign: "center" }}>
                  No journal entries for this day.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {!!entries?.length && (
          <div className="totals">
            <span>Total Debit: {dayDebit.toLocaleString()}</span>
            <span className="grand">Total Credit: {dayCredit.toLocaleString()}</span>
          </div>
        )}

        <PrintSignoff ourLabel="Prepared By (Accounts)" theirLabel="Verified By (Owner)" signatureUrl={signatureUrl} stampUrl={stampUrl} />

        <PrintFooter />

        <script dangerouslySetInnerHTML={{ __html: AUTO_PRINT_SCRIPT }} />
      </div>
    </>
  );
}
