import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { printStyles, AUTO_PRINT_SCRIPT } from "@/lib/printStyles";
import { getCompanyBrandingUrls } from "@/lib/companyBranding";
import { PrintLogoBlock } from "@/components/PrintLogoBlock";
import { PrintSignoff } from "@/components/PrintSignoff";
import { PrintBackLink } from "@/components/PrintBackLink";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: quotation } = await supabase.from("quotations").select("quotation_no").eq("id", id).maybeSingle();
  return { title: quotation?.quotation_no ?? "Quotation" };
}

export default async function QuotationPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ signature?: string; stamp?: string; phone?: string; email?: string; autoprint?: string }>;
}) {
  const { id } = await params;
  const { signature, stamp, phone, email, autoprint } = await searchParams;
  const supabase = await createClient();

  const [{ data: quotation }, { data: company }] = await Promise.all([
    supabase
      .from("quotations")
      .select("*, parties(legal_name, billing_address, ntn, strn), queries(query_no, requirement)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("company").select("*").maybeSingle(),
  ]);

  if (!quotation) notFound();

  const { logoUrl, signatureUrl, stampUrl } = await getCompanyBrandingUrls(supabase, company, {
    signature: signature === "1",
    stamp: stamp === "1",
  });

  const { data: revision } = await supabase
    .from("quotation_revisions")
    .select("*")
    .eq("quotation_id", id)
    .eq("is_current", true)
    .maybeSingle();

  if (!revision) notFound();

  const { data: lines } = await supabase.from("quotation_lines").select("*").eq("revision_id", revision.id).order("sort_order");

  const party = quotation.parties as unknown as { legal_name: string; billing_address: string | null; ntn: string | null; strn: string | null } | null;
  const query = quotation.queries as unknown as { query_no: string; requirement: string } | null;

  return (
    <>
      {autoprint !== "0" && <PrintBackLink href={`/quotations/${id}`} />}
      <div className="print-quote">
        <style dangerouslySetInnerHTML={{ __html: printStyles("print-quote") }} />

        <svg className="watermark" width="260" height="260" viewBox="0 0 40 40">
          <polyline points="9,20 20,11 31,20" fill="none" stroke="#2b3a55" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="12" y="20" width="16" height="10" rx="1.4" fill="none" stroke="#2b3a55" strokeWidth="2.2" />
        </svg>

        <div className="hdr">
          <PrintLogoBlock company={company} logoUrl={logoUrl} showPhone={phone === "1"} showEmail={email === "1"} />
          <div style={{ textAlign: "right" }}>
            <h1>QUOTATION</h1>
            <div className="muted">
              {quotation.quotation_no} — Rev-{revision.rev_no}
            </div>
            <div className="muted">{new Date(revision.created_at).toLocaleDateString("en-PK")}</div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
          <div>
            <div className="muted">Bill To</div>
            <div style={{ fontWeight: 600 }}>{party?.legal_name}</div>
            {party?.billing_address && <div className="muted">{party.billing_address}</div>}
            {party?.ntn && <div className="muted">NTN: {party.ntn}</div>}
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="muted">Reference Query</div>
            <div>{query?.query_no}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th className="num">Qty</th>
              <th>Unit</th>
              <th className="num">Rate</th>
              <th className="num">Tax %</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(lines ?? []).map((l) => (
              <tr key={l.id}>
                <td>{l.description}</td>
                <td className="num">{l.qty}</td>
                <td>{l.unit ?? "—"}</td>
                <td className="num">{l.rate}</td>
                <td className="num">{l.tax_pct}%</td>
                <td className="num">{l.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="totals">
          <span>Subtotal: {revision.subtotal}</span>
          <span>Tax: {revision.tax_total}</span>
          <span className="grand">
            Total: {revision.grand_total} {company?.base_currency}
          </span>
        </div>

        <dl className="terms">
          {revision.validity_date && (
            <>
              <dt>Validity</dt>
              <dd>{revision.validity_date}</dd>
            </>
          )}
          {revision.delivery_terms && (
            <>
              <dt>Delivery Terms</dt>
              <dd>{revision.delivery_terms}</dd>
            </>
          )}
          {revision.payment_terms && (
            <>
              <dt>Payment Terms</dt>
              <dd>{revision.payment_terms}</dd>
            </>
          )}
          {revision.terms && (
            <>
              <dt>Terms &amp; Conditions</dt>
              <dd style={{ whiteSpace: "pre-wrap" }}>{revision.terms}</dd>
            </>
          )}
        </dl>

        <PrintSignoff ourLabel="Authorized By" theirLabel="Client Acceptance" signatureUrl={signatureUrl} stampUrl={stampUrl} />

        <script dangerouslySetInnerHTML={{ __html: AUTO_PRINT_SCRIPT }} />
      </div>
    </>
  );
}
