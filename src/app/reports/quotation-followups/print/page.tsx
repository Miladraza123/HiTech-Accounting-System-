import { createClient } from "@/lib/supabase/server";
import { daysSince } from "@/lib/orderHealth";
import { printStyles, AUTO_PRINT_SCRIPT } from "@/lib/printStyles";
import { getCompanyBrandingUrls } from "@/lib/companyBranding";
import { PrintLogoBlock } from "@/components/PrintLogoBlock";
import { PrintFooter } from "@/components/PrintFooter";
import { PrintWatermark } from "@/components/PrintWatermark";
import { PrintSignoff } from "@/components/PrintSignoff";
import { PrintBackLink } from "@/components/PrintBackLink";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Quotation Follow-up Due" };

export default async function QuotationFollowupsPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ signature?: string; stamp?: string; phone?: string; email?: string; autoprint?: string }>;
}) {
  const { signature, stamp, phone, email, autoprint } = await searchParams;

  const today = new Date().toISOString().slice(0, 10);
  const supabase = await createClient();
  const [{ data: quotations }, { data: company }] = await Promise.all([
    supabase
      .from("quotations")
      .select("id, quotation_no, status, parties(legal_name), queries!inner(query_no, next_followup_at)")
      .eq("status", "Sent")
      .not("queries.next_followup_at", "is", null)
      .lte("queries.next_followup_at", today)
      .order("created_at", { ascending: false }),
    supabase.from("company").select("*").maybeSingle(),
  ]);

  type QueryInfo = { query_no: string; next_followup_at: string | null };
  const rows = (quotations ?? [])
    .map((q) => {
      const party = q.parties as unknown as { legal_name: string } | null;
      const query = q.queries as unknown as QueryInfo;
      return {
        id: q.id,
        quotation_no: q.quotation_no,
        client: party?.legal_name ?? "—",
        query_no: query.query_no,
        followupDate: query.next_followup_at!,
        overdueDays: daysSince(query.next_followup_at!),
      };
    })
    .sort((a, b) => b.overdueDays - a.overdueDays);

  const { logoUrl, signatureUrl, stampUrl } = await getCompanyBrandingUrls(supabase, company, {
    signature: signature === "1",
    stamp: stamp === "1",
  });

  return (
    <>
      {autoprint !== "0" && <PrintBackLink href="/reports/quotation-followups" />}
      <div className="print-qf">
        <style dangerouslySetInnerHTML={{ __html: printStyles("print-qf") }} />

        <PrintWatermark logoUrl={logoUrl} />

        <div className="hdr">
          <PrintLogoBlock company={company} logoUrl={logoUrl} showPhone={phone === "1"} showEmail={email === "1"} />
          <div style={{ textAlign: "right" }}>
            <h1>QUOTATION FOLLOW-UP DUE</h1>
            <div className="muted">As of {today}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Quotation #</th>
              <th>Query #</th>
              <th>Client</th>
              <th>Follow-up Date</th>
              <th className="num">Days Overdue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.quotation_no}</td>
                <td>{r.query_no}</td>
                <td>{r.client}</td>
                <td>{r.followupDate}</td>
                <td className="num">{r.overdueDays > 0 ? r.overdueDays : "Today"}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} style={{ textAlign: "center" }}>
                  No follow-ups due.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="totals">
          <span className="grand">Follow-ups Due: {rows.length}</span>
        </div>

        <PrintSignoff ourLabel="Prepared By (Sales)" theirLabel="Verified By (Owner)" signatureUrl={signatureUrl} stampUrl={stampUrl} />

        <PrintFooter />

        <script dangerouslySetInnerHTML={{ __html: AUTO_PRINT_SCRIPT }} />
      </div>
    </>
  );
}
