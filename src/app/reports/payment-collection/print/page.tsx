import { createClient } from "@/lib/supabase/server";
import { printStyles, AUTO_PRINT_SCRIPT } from "@/lib/printStyles";
import { getCompanyBrandingUrls } from "@/lib/companyBranding";
import { PrintLogoBlock } from "@/components/PrintLogoBlock";
import { PrintFooter } from "@/components/PrintFooter";
import { PrintWatermark } from "@/components/PrintWatermark";
import { PrintSignoff } from "@/components/PrintSignoff";
import { PrintBackLink } from "@/components/PrintBackLink";
import type { Metadata } from "next";

function defaultMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { from, to };
}

export const metadata: Metadata = { title: "Payment Collection Report" };

export default async function PaymentCollectionPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; signature?: string; stamp?: string; phone?: string; email?: string; autoprint?: string }>;
}) {
  const { from, to, signature, stamp, phone, email, autoprint } = await searchParams;
  const defaults = defaultMonthRange();
  const fromDate = from || defaults.from;
  const toDate = to || defaults.to;

  const supabase = await createClient();
  const [{ data: payments }, { data: company }] = await Promise.all([
    supabase
      .from("payments")
      .select("*, parties(legal_name)")
      .gte("payment_date", fromDate)
      .lte("payment_date", toDate)
      .eq("status", "Posted")
      .order("payment_date", { ascending: false }),
    supabase.from("company").select("*").maybeSingle(),
  ]);

  const { logoUrl, signatureUrl, stampUrl } = await getCompanyBrandingUrls(supabase, company, {
    signature: signature === "1",
    stamp: stamp === "1",
  });

  const receipts = (payments ?? []).filter((p) => p.direction === "receipt");
  const disbursements = (payments ?? []).filter((p) => p.direction === "payment");
  const totalReceipts = receipts.reduce((s, p) => s + p.amount, 0);
  const totalDisbursements = disbursements.reduce((s, p) => s + p.amount, 0);

  const byMethod = new Map<string, number>();
  for (const p of receipts) {
    const key = p.method || "—";
    byMethod.set(key, (byMethod.get(key) ?? 0) + p.amount);
  }

  const byClient = new Map<string, number>();
  for (const p of receipts) {
    const name = (p.parties as unknown as { legal_name: string } | null)?.legal_name ?? "—";
    byClient.set(name, (byClient.get(name) ?? 0) + p.amount);
  }
  const topClients = [...byClient.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  return (
    <>
      {autoprint !== "0" && <PrintBackLink href={`/reports/payment-collection?from=${fromDate}&to=${toDate}`} />}
      <div className="print-pc">
        <style dangerouslySetInnerHTML={{ __html: printStyles("print-pc") }} />

        <PrintWatermark logoUrl={logoUrl} />

        <div className="hdr">
          <PrintLogoBlock company={company} logoUrl={logoUrl} showPhone={phone === "1"} showEmail={email === "1"} />
          <div style={{ textAlign: "right" }}>
            <h1>PAYMENT COLLECTION REPORT</h1>
            <div className="muted">
              {fromDate} — {toDate}
            </div>
          </div>
        </div>

        <div className="totals" style={{ marginTop: 0 }}>
          <span>Total Collected (Receipts): {totalReceipts.toLocaleString()}</span>
          <span>Total Disbursed (Payments): {totalDisbursements.toLocaleString()}</span>
          <span className="grand">Net: {(totalReceipts - totalDisbursements).toLocaleString()}</span>
        </div>

        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 20, marginBottom: 4 }}>Collection by Method</div>
        <table>
          <thead>
            <tr>
              <th>Method</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {[...byMethod.entries()].map(([method, amt]) => (
              <tr key={method}>
                <td>{method}</td>
                <td className="num">{amt.toLocaleString()}</td>
              </tr>
            ))}
            {!byMethod.size && (
              <tr>
                <td colSpan={2} style={{ textAlign: "center" }}>
                  No receipts for this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 20, marginBottom: 4 }}>Top Clients (by Collection)</div>
        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {topClients.map(([name, amt]) => (
              <tr key={name}>
                <td>{name}</td>
                <td className="num">{amt.toLocaleString()}</td>
              </tr>
            ))}
            {!topClients.length && (
              <tr>
                <td colSpan={2} style={{ textAlign: "center" }}>
                  No receipts for this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 20, marginBottom: 4 }}>All Transactions</div>
        <table>
          <thead>
            <tr>
              <th>Payment #</th>
              <th>Party</th>
              <th>Direction</th>
              <th>Method</th>
              <th>Date</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(payments ?? []).map((p) => (
              <tr key={p.id}>
                <td>{p.payment_no}</td>
                <td>{(p.parties as unknown as { legal_name: string } | null)?.legal_name ?? "—"}</td>
                <td>{p.direction === "receipt" ? "Receipt" : "Payment"}</td>
                <td>{p.method ?? "—"}</td>
                <td>{p.payment_date}</td>
                <td className="num">{p.amount.toLocaleString()}</td>
              </tr>
            ))}
            {!payments?.length && (
              <tr>
                <td colSpan={6} style={{ textAlign: "center" }}>
                  No payments for this period.
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
