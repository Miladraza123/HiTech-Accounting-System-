import { createClient } from "@/lib/supabase/server";
import { printStyles, AUTO_PRINT_SCRIPT } from "@/lib/printStyles";
import { getCompanyBrandingUrls } from "@/lib/companyBranding";
import { PrintLogoBlock } from "@/components/PrintLogoBlock";
import { PrintFooter } from "@/components/PrintFooter";
import { PrintWatermark } from "@/components/PrintWatermark";
import { PrintSignoff } from "@/components/PrintSignoff";
import { PrintBackLink } from "@/components/PrintBackLink";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Daily Snapshot" };

export default async function DailySnapshotPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ signature?: string; stamp?: string; phone?: string; email?: string; autoprint?: string }>;
}) {
  const { signature, stamp, phone, email, autoprint } = await searchParams;

  const supabase = await createClient();
  const [{ data: snapshots }, { data: company }] = await Promise.all([
    supabase.from("daily_snapshots").select("*").order("snapshot_date", { ascending: false }).limit(90),
    supabase.from("company").select("*").maybeSingle(),
  ]);

  const { logoUrl, signatureUrl, stampUrl } = await getCompanyBrandingUrls(supabase, company, {
    signature: signature === "1",
    stamp: stamp === "1",
  });

  const rows = snapshots ?? [];
  const latest = rows[0];

  return (
    <>
      {autoprint !== "0" && <PrintBackLink href="/reports/daily-snapshot" />}
      <div className="print-ds">
        <style dangerouslySetInnerHTML={{ __html: printStyles("print-ds") }} />

        <PrintWatermark logoUrl={logoUrl} />

        <div className="hdr">
          <PrintLogoBlock company={company} logoUrl={logoUrl} showPhone={phone === "1"} showEmail={email === "1"} />
          <div style={{ textAlign: "right" }}>
            <h1>DAILY SNAPSHOT</h1>
            <div className="muted">As of {new Date().toISOString().slice(0, 10)}</div>
          </div>
        </div>

        {latest && (
          <>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Latest Snapshot — {latest.snapshot_date}</div>
            <table>
              <tbody>
                <tr>
                  <td>Cash in Hand</td>
                  <td className="num">{latest.cash_in_hand.toLocaleString()}</td>
                  <td>Stock Value</td>
                  <td className="num">{latest.stock_value.toLocaleString()}</td>
                </tr>
                <tr>
                  <td>Bank Balance</td>
                  <td className="num">{latest.bank_balance.toLocaleString()}</td>
                  <td>Outstanding Receivable</td>
                  <td className="num">{latest.total_ar_outstanding.toLocaleString()}</td>
                </tr>
                <tr>
                  <td>Petty Cash</td>
                  <td className="num">{latest.petty_cash_balance.toLocaleString()}</td>
                  <td>Outstanding Payable</td>
                  <td className="num">{latest.total_ap_outstanding.toLocaleString()}</td>
                </tr>
                <tr>
                  <td>Sales ({latest.snapshot_date})</td>
                  <td className="num">{latest.sales_today.toLocaleString()}</td>
                  <td>Expenses ({latest.snapshot_date})</td>
                  <td className="num">{latest.expenses_today.toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}

        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 20, marginBottom: 4 }}>History (Last 90 Days)</div>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th className="num">Cash</th>
              <th className="num">Bank</th>
              <th className="num">Petty Cash</th>
              <th className="num">Stock Value</th>
              <th className="num">AR</th>
              <th className="num">AP</th>
              <th className="num">Sales</th>
              <th className="num">Collections</th>
              <th className="num">Payments</th>
              <th className="num">Expenses</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>{s.snapshot_date}</td>
                <td className="num">{s.cash_in_hand.toLocaleString()}</td>
                <td className="num">{s.bank_balance.toLocaleString()}</td>
                <td className="num">{s.petty_cash_balance.toLocaleString()}</td>
                <td className="num">{s.stock_value.toLocaleString()}</td>
                <td className="num">{s.total_ar_outstanding.toLocaleString()}</td>
                <td className="num">{s.total_ap_outstanding.toLocaleString()}</td>
                <td className="num">{s.sales_today.toLocaleString()}</td>
                <td className="num">{s.collections_today.toLocaleString()}</td>
                <td className="num">{s.payments_today.toLocaleString()}</td>
                <td className="num">{s.expenses_today.toLocaleString()}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={11} style={{ textAlign: "center" }}>
                  No snapshot history available.
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
