import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { printStyles, AUTO_PRINT_SCRIPT } from "@/lib/printStyles";
import { getCompanyBrandingUrls } from "@/lib/companyBranding";
import { PrintLogoBlock } from "@/components/PrintLogoBlock";
import { PrintSignoff } from "@/components/PrintSignoff";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: invoice } = await supabase.from("invoices").select("invoice_no").eq("id", id).maybeSingle();
  return { title: invoice?.invoice_no ?? "Invoice" };
}

export default async function InvoicePrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ signature?: string; stamp?: string }>;
}) {
  const { id } = await params;
  const { signature, stamp } = await searchParams;
  const supabase = await createClient();

  const [{ data: invoice }, { data: company }, { data: lines }] = await Promise.all([
    supabase
      .from("invoices")
      .select("*, parties(legal_name, billing_address, ntn, strn, cnic), sales_orders(so_no, client_po_number)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("company").select("*").maybeSingle(),
    supabase.from("invoice_lines").select("*, items(item_code, hs_code)").eq("invoice_id", id).order("sort_order"),
  ]);

  if (!invoice) notFound();

  const { logoUrl, signatureUrl, stampUrl } = await getCompanyBrandingUrls(supabase, company, {
    signature: signature === "1",
    stamp: stamp === "1",
  });

  const party = invoice.parties as unknown as {
    legal_name: string;
    billing_address: string | null;
    ntn: string | null;
    strn: string | null;
    cnic: string | null;
  } | null;
  const so = invoice.sales_orders as unknown as { so_no: string; client_po_number: string } | null;

  return (
    <div className="print-inv">
      <style dangerouslySetInnerHTML={{ __html: printStyles("print-inv") }} />

      <svg className="watermark" width="260" height="260" viewBox="0 0 40 40">
        <polyline points="9,20 20,11 31,20" fill="none" stroke="#2b3a55" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="12" y="20" width="16" height="10" rx="1.4" fill="none" stroke="#2b3a55" strokeWidth="2.2" />
      </svg>

      <div className="hdr">
        <PrintLogoBlock company={company} logoUrl={logoUrl} />
        <div style={{ textAlign: "right" }}>
          <h1>GST SALES TAX INVOICE</h1>
          <div className="muted">{invoice.invoice_no}</div>
          <div className="muted">{invoice.invoice_date}</div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
        <div>
          <div className="muted">Bill To</div>
          <div style={{ fontWeight: 600 }}>{party?.legal_name}</div>
          {party?.billing_address && <div className="muted">{party.billing_address}</div>}
          <div className="muted">
            {party?.ntn && <>NTN: {party.ntn} </>}
            {party?.strn && <>STRN: {party.strn} </>}
            {party?.cnic && <>CNIC: {party.cnic}</>}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="muted">Sales Order</div>
          <div>{so?.so_no}</div>
          {so?.client_po_number && <div className="muted">PO: {so.client_po_number}</div>}
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Description</th>
            <th>HS Code</th>
            <th className="num">Qty</th>
            <th>Unit</th>
            <th className="num">Rate</th>
            <th className="num">Tax %</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {(lines ?? []).map((l) => {
            const item = l.items as unknown as { item_code: string; hs_code: string | null } | null;
            return (
              <tr key={l.id}>
                <td>{l.description}</td>
                <td>{item?.hs_code ?? "—"}</td>
                <td className="num">{l.qty}</td>
                <td>{l.unit ?? "—"}</td>
                <td className="num">{l.rate}</td>
                <td className="num">{l.tax_pct}%</td>
                <td className="num">{l.amount}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="totals">
        <span>Subtotal: {invoice.subtotal}</span>
        <span>GST: {invoice.tax_total}</span>
        <span className="grand">
          Total: {invoice.grand_total} {company?.base_currency}
        </span>
      </div>

      <PrintSignoff
        ourLabel="Prepared By"
        theirLabel="Received By (Client Signature & Stamp)"
        signatureUrl={signatureUrl}
        stampUrl={stampUrl}
      />

      <script dangerouslySetInnerHTML={{ __html: AUTO_PRINT_SCRIPT }} />
    </div>
  );
}
