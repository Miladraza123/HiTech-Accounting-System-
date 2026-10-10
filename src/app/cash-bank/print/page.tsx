import { createClient } from "@/lib/supabase/server";
import { printStyles, AUTO_PRINT_SCRIPT } from "@/lib/printStyles";
import { getCompanyBrandingUrls } from "@/lib/companyBranding";
import { PrintLogoBlock } from "@/components/PrintLogoBlock";
import { PrintFooter } from "@/components/PrintFooter";
import { PrintWatermark } from "@/components/PrintWatermark";
import { PrintSignoff } from "@/components/PrintSignoff";
import { PrintBackLink } from "@/components/PrintBackLink";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Cash & Bank Position" };

export default async function CashBankPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ signature?: string; stamp?: string; phone?: string; email?: string; autoprint?: string }>;
}) {
  const { signature, stamp, phone, email, autoprint } = await searchParams;

  const supabase = await createClient();
  const [{ data: cashRow }, { data: bankBalances }, { data: pettyBalances }, { data: company }] = await Promise.all([
    supabase.from("cash_in_hand_balance").select("*").maybeSingle(),
    supabase.from("bank_account_balances").select("*").eq("is_active", true).order("account_name"),
    supabase.from("petty_cash_fund_balances").select("*").eq("is_active", true).order("fund_name"),
    supabase.from("company").select("*").maybeSingle(),
  ]);

  const { logoUrl, signatureUrl, stampUrl } = await getCompanyBrandingUrls(supabase, company, {
    signature: signature === "1",
    stamp: stamp === "1",
  });

  const cashBalance = cashRow?.balance ?? 0;
  const bankTotal = (bankBalances ?? []).reduce((s, b) => s + (b.balance ?? 0), 0);
  const pettyTotal = (pettyBalances ?? []).reduce((s, p) => s + (p.balance ?? 0), 0);
  const grandTotal = cashBalance + bankTotal + pettyTotal;

  return (
    <>
      {autoprint !== "0" && <PrintBackLink href="/cash-bank" />}
      <div className="print-cb">
        <style dangerouslySetInnerHTML={{ __html: printStyles("print-cb") }} />

        <PrintWatermark logoUrl={logoUrl} />

        <div className="hdr">
          <PrintLogoBlock company={company} logoUrl={logoUrl} showPhone={phone === "1"} showEmail={email === "1"} />
          <div style={{ textAlign: "right" }}>
            <h1>CASH &amp; BANK POSITION</h1>
            <div className="muted">As of {new Date().toISOString().slice(0, 10)}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Summary</th>
              <th className="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Cash in Hand</td>
              <td className="num">{cashBalance.toLocaleString()}</td>
            </tr>
            <tr>
              <td>Bank Accounts</td>
              <td className="num">{bankTotal.toLocaleString()}</td>
            </tr>
            <tr>
              <td>Petty Cash</td>
              <td className="num">{pettyTotal.toLocaleString()}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Total Cash Position</td>
              <td className="num" style={{ fontWeight: 700 }}>
                {grandTotal.toLocaleString()}
              </td>
            </tr>
          </tbody>
        </table>

        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 20, marginBottom: 4 }}>Bank Accounts</div>
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Bank</th>
              <th className="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            {(bankBalances ?? []).map((b) => (
              <tr key={b.bank_account_id}>
                <td>{b.account_name}</td>
                <td>{b.bank_name ?? "—"}</td>
                <td className="num">{(b.balance ?? 0).toLocaleString()}</td>
              </tr>
            ))}
            {!bankBalances?.length && (
              <tr>
                <td colSpan={3} style={{ textAlign: "center" }}>
                  No active bank account.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 20, marginBottom: 4 }}>Petty Cash Funds</div>
        <table>
          <thead>
            <tr>
              <th>Fund</th>
              <th className="num">Balance</th>
            </tr>
          </thead>
          <tbody>
            {(pettyBalances ?? []).map((p) => (
              <tr key={p.petty_cash_fund_id}>
                <td>{p.fund_name}</td>
                <td className="num">{(p.balance ?? 0).toLocaleString()}</td>
              </tr>
            ))}
            {!pettyBalances?.length && (
              <tr>
                <td colSpan={2} style={{ textAlign: "center" }}>
                  No active petty cash fund.
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
