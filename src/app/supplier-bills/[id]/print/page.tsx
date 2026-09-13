import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { printStyles, AUTO_PRINT_SCRIPT } from "@/lib/printStyles";
import { getCompanyBrandingUrls } from "@/lib/companyBranding";
import { PrintLogoBlock } from "@/components/PrintLogoBlock";
import { PrintBackLink } from "@/components/PrintBackLink";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: bill } = await supabase.from("supplier_bills").select("bill_no").eq("id", id).maybeSingle();
  return { title: bill?.bill_no ?? "Supplier Bill" };
}

export default async function SupplierBillPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ phone?: string; email?: string; autoprint?: string }>;
}) {
  const { id } = await params;
  const { phone, email, autoprint } = await searchParams;
  const supabase = await createClient();

  const [{ data: bill }, { data: company }, { data: lines }] = await Promise.all([
    supabase
      .from("supplier_bills")
      .select("*, parties(legal_name, billing_address, ntn, strn), grns(grn_no, received_date)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("company").select("*").maybeSingle(),
    supabase.from("supplier_bill_lines").select("*, items(item_code, description)").eq("supplier_bill_id", id).order("sort_order"),
  ]);

  if (!bill) notFound();

  // Supplier Bill is an internal bookkeeping record (a bill we received,
  // not a document we issue outward) — no signoff box, so no signature/
  // stamp to resolve, only the letterhead logo.
  const { logoUrl } = await getCompanyBrandingUrls(supabase, company, { signature: false, stamp: false });

  const supplier = bill.parties as unknown as { legal_name: string; billing_address: string | null; ntn: string | null; strn: string | null } | null;
  const grn = bill.grns as unknown as { grn_no: string; received_date: string } | null;

  return (
    <>
      {autoprint !== "0" && <PrintBackLink href={`/supplier-bills/${id}`} />}
      <div className="print-sb">
        <style dangerouslySetInnerHTML={{ __html: printStyles("print-sb") }} />

        <svg className="watermark" width="260" height="260" viewBox="0 0 40 40">
          <polyline points="9,20 20,11 31,20" fill="none" stroke="#2b3a55" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="12" y="20" width="16" height="10" rx="1.4" fill="none" stroke="#2b3a55" strokeWidth="2.2" />
        </svg>

        <div className="hdr">
          <PrintLogoBlock company={company} logoUrl={logoUrl} showPhone={phone === "1"} showEmail={email === "1"} />
          <div style={{ textAlign: "right" }}>
            <h1>SUPPLIER BILL</h1>
            <div className="muted">{bill.bill_no}</div>
            <div className="muted">{bill.bill_date}</div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
          <div>
            <div className="muted">Supplier</div>
            <div style={{ fontWeight: 600 }}>{supplier?.legal_name}</div>
            {supplier?.billing_address && <div className="muted">{supplier.billing_address}</div>}
            {supplier?.ntn && <div className="muted">NTN: {supplier.ntn}</div>}
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="muted">Against GRN</div>
            <div>{grn?.grn_no}</div>
            {bill.supplier_bill_ref && <div className="muted">Supplier Ref#: {bill.supplier_bill_ref}</div>}
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">Qty</th>
              <th className="num">Rate</th>
              <th className="num">Tax %</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(lines ?? []).map((l) => {
              const item = l.items as unknown as { item_code: string; description: string } | null;
              return (
                <tr key={l.id}>
                  <td>{item ? `${item.item_code} — ${item.description}` : l.description}</td>
                  <td className="num">{l.qty}</td>
                  <td className="num">{l.rate}</td>
                  <td className="num">{l.tax_pct}%</td>
                  <td className="num">{l.amount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="totals">
          <span>Subtotal: {bill.subtotal}</span>
          <span>Tax: {bill.tax_total}</span>
          <span className="grand">
            Total: {bill.grand_total} {company?.base_currency}
          </span>
        </div>

        <script dangerouslySetInnerHTML={{ __html: AUTO_PRINT_SCRIPT }} />
      </div>
    </>
  );
}
