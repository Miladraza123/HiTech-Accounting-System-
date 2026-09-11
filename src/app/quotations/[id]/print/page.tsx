import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: quotation } = await supabase.from("quotations").select("quotation_no").eq("id", id).maybeSingle();
  return { title: quotation?.quotation_no ?? "Quotation" };
}

export default async function QuotationPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
    <div className="print-quote">
      <style
        dangerouslySetInnerHTML={{
          __html: `
            .print-quote { all: initial; display: block; font-family: ui-sans-serif, system-ui, sans-serif; color: #20242E; background: #fff; padding: 32px; }
            .print-quote * { box-sizing: border-box; }
            .print-quote .hdr { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #20242E; padding-bottom: 16px; margin-bottom: 20px; }
            .print-quote .co-name { font-size: 20px; font-weight: 700; }
            .print-quote .muted { color: #565B68; font-size: 12px; }
            .print-quote h1 { font-size: 16px; margin: 0 0 2px; }
            .print-quote table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }
            .print-quote th, .print-quote td { border: 1px solid #DDD6C7; padding: 6px 10px; text-align: left; }
            .print-quote th { background: #EFEAE0; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
            .print-quote td.num, .print-quote th.num { text-align: right; font-variant-numeric: tabular-nums; }
            .print-quote .totals { display: flex; justify-content: flex-end; gap: 24px; margin-top: 8px; font-size: 13px; }
            .print-quote .totals .grand { font-weight: 700; }
            .print-quote .terms { margin-top: 24px; font-size: 12px; }
            .print-quote .terms dt { color: #565B68; margin-top: 8px; }
            .print-quote .terms dd { margin: 2px 0 0; }
            @media print { .print-quote { padding: 0; } }
          `,
        }}
      />

      <div className="hdr">
        <div>
          <div className="co-name">{company?.legal_name ?? "Company"}</div>
          {company?.address && <div className="muted">{company.address}</div>}
          <div className="muted">
            {company?.ntn && <>NTN: {company.ntn} </>}
            {company?.strn && <>STRN: {company.strn}</>}
          </div>
        </div>
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

      <script
        dangerouslySetInnerHTML={{
          __html: `window.addEventListener('load', () => setTimeout(() => window.print(), 300));`,
        }}
      />
    </div>
  );
}
