import { createClient } from "@/lib/supabase/server";
import { printStyles, AUTO_PRINT_SCRIPT } from "@/lib/printStyles";
import { getCompanyBrandingUrls } from "@/lib/companyBranding";
import { PrintLogoBlock } from "@/components/PrintLogoBlock";
import { PrintFooter } from "@/components/PrintFooter";
import { PrintWatermark } from "@/components/PrintWatermark";
import { PrintSignoff } from "@/components/PrintSignoff";
import { PrintBackLink } from "@/components/PrintBackLink";
import type { Metadata } from "next";

const CASH_CODES = ["1050", "1100", "1060"];
const ACCOUNT_LABEL: Record<string, string> = { "1050": "Cash in Hand", "1100": "Bank Accounts", "1060": "Petty Cash" };

function defaultMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { from, to };
}

export const metadata: Metadata = { title: "Cash Flow & Position" };

export default async function CashFlowPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; signature?: string; stamp?: string; phone?: string; email?: string; autoprint?: string }>;
}) {
  const { from, to, signature, stamp, phone, email, autoprint } = await searchParams;
  const defaults = defaultMonthRange();
  const fromDate = from || defaults.from;
  const toDate = to || defaults.to;

  const supabase = await createClient();

  const [{ data: opening }, { data: periodEntries }, { data: company }] = await Promise.all([
    supabase.rpc("fn_cash_opening_balances", { p_before: fromDate }),
    supabase
      .from("journal_entries")
      .select("entry_date, narration, journal_lines(debit, credit, chart_of_accounts(code, name))")
      .gte("entry_date", fromDate)
      .lte("entry_date", toDate)
      .order("entry_date"),
    supabase.from("company").select("*").maybeSingle(),
  ]);

  type Line = { debit: number; credit: number; chart_of_accounts: { code: string; name?: string } | null };

  const openingByCode: Record<string, number> = { "1050": 0, "1100": 0, "1060": 0 };
  for (const row of opening ?? []) {
    if (CASH_CODES.includes(row.code)) openingByCode[row.code] = row.opening;
  }

  const receiptsByCode: Record<string, number> = { "1050": 0, "1100": 0, "1060": 0 };
  const paymentsByCode: Record<string, number> = { "1050": 0, "1100": 0, "1060": 0 };
  const transactions: { date: string; narration: string; account: string; debit: number; credit: number }[] = [];

  for (const e of periodEntries ?? []) {
    const lines = e.journal_lines as unknown as Line[];
    for (const l of lines) {
      const code = l.chart_of_accounts?.code;
      if (!code || !CASH_CODES.includes(code)) continue;
      receiptsByCode[code] += l.debit;
      paymentsByCode[code] += l.credit;
      transactions.push({ date: e.entry_date, narration: e.narration ?? "", account: ACCOUNT_LABEL[code], debit: l.debit, credit: l.credit });
    }
  }

  const totalOpening = CASH_CODES.reduce((s, c) => s + openingByCode[c], 0);
  const totalReceipts = CASH_CODES.reduce((s, c) => s + receiptsByCode[c], 0);
  const totalPayments = CASH_CODES.reduce((s, c) => s + paymentsByCode[c], 0);
  const totalClosing = totalOpening + totalReceipts - totalPayments;

  const transactionsWithBalance = transactions.reduce<(typeof transactions[number] & { running: number })[]>((acc, t) => {
    const prev = acc.length ? acc[acc.length - 1].running : totalOpening;
    acc.push({ ...t, running: prev + t.debit - t.credit });
    return acc;
  }, []);

  const { logoUrl, signatureUrl, stampUrl } = await getCompanyBrandingUrls(supabase, company, {
    signature: signature === "1",
    stamp: stamp === "1",
  });

  return (
    <>
      {autoprint !== "0" && <PrintBackLink href={`/reports/cash-flow?from=${fromDate}&to=${toDate}`} />}
      <div className="print-cf">
        <style dangerouslySetInnerHTML={{ __html: printStyles("print-cf") }} />

        <PrintWatermark logoUrl={logoUrl} />

        <div className="hdr">
          <PrintLogoBlock company={company} logoUrl={logoUrl} showPhone={phone === "1"} showEmail={email === "1"} />
          <div style={{ textAlign: "right" }}>
            <h1>CASH FLOW &amp; POSITION</h1>
            <div className="muted">Cash Book / Bank Book</div>
            <div className="muted">
              {fromDate} — {toDate}
            </div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th className="num">Opening</th>
              <th className="num">Receipts</th>
              <th className="num">Payments</th>
              <th className="num">Closing</th>
            </tr>
          </thead>
          <tbody>
            {CASH_CODES.map((code) => (
              <tr key={code}>
                <td>{ACCOUNT_LABEL[code]}</td>
                <td className="num">{openingByCode[code].toLocaleString()}</td>
                <td className="num">+{receiptsByCode[code].toLocaleString()}</td>
                <td className="num">-{paymentsByCode[code].toLocaleString()}</td>
                <td className="num">{(openingByCode[code] + receiptsByCode[code] - paymentsByCode[code]).toLocaleString()}</td>
              </tr>
            ))}
            <tr>
              <td style={{ fontWeight: 700 }}>Total</td>
              <td className="num" style={{ fontWeight: 700 }}>
                {totalOpening.toLocaleString()}
              </td>
              <td className="num" style={{ fontWeight: 700 }}>
                +{totalReceipts.toLocaleString()}
              </td>
              <td className="num" style={{ fontWeight: 700 }}>
                -{totalPayments.toLocaleString()}
              </td>
              <td className="num" style={{ fontWeight: 700 }}>
                {totalClosing.toLocaleString()}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="totals" style={{ marginTop: 20, marginBottom: 4 }}>
          <span style={{ fontWeight: 600 }}>Transactions</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Narration</th>
              <th>Account</th>
              <th className="num">Debit</th>
              <th className="num">Credit</th>
              <th className="num">Running Balance</th>
            </tr>
          </thead>
          <tbody>
            {transactionsWithBalance.map((t, i) => (
              <tr key={i}>
                <td>{t.date}</td>
                <td>{t.narration}</td>
                <td>{t.account}</td>
                <td className="num">{t.debit > 0 ? t.debit.toLocaleString() : ""}</td>
                <td className="num">{t.credit > 0 ? t.credit.toLocaleString() : ""}</td>
                <td className="num">{t.running.toLocaleString()}</td>
              </tr>
            ))}
            {!transactions.length && (
              <tr>
                <td colSpan={6} style={{ textAlign: "center" }}>
                  No Cash/Bank/Petty Cash transactions in this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <PrintSignoff ourLabel="Prepared By (Accounts)" theirLabel="Verified By (Owner)" signatureUrl={signatureUrl} stampUrl={stampUrl} />

        <PrintFooter />

        <script dangerouslySetInnerHTML={{ __html: AUTO_PRINT_SCRIPT }} />
      </div>
    </>
  );
}
