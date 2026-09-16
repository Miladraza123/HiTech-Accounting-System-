import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { printStyles, AUTO_PRINT_SCRIPT } from "@/lib/printStyles";
import { getCompanyBrandingUrls } from "@/lib/companyBranding";
import { PrintLogoBlock } from "@/components/PrintLogoBlock";
import { PrintWatermark } from "@/components/PrintWatermark";
import { PrintSignoff } from "@/components/PrintSignoff";
import { PrintBackLink } from "@/components/PrintBackLink";
import type { Metadata } from "next";

const TYPE_LABEL: Record<string, string> = { direct: "Direct (Client Order)", stock: "Stock", general: "General" };

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: po } = await supabase.from("purchase_orders").select("po_no").eq("id", id).maybeSingle();
  return { title: po?.po_no ?? "Purchase Order" };
}

export default async function PurchaseOrderPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ signature?: string; stamp?: string; phone?: string; email?: string; autoprint?: string }>;
}) {
  const { id } = await params;
  const { signature, stamp, phone, email, autoprint } = await searchParams;
  const supabase = await createClient();

  const [{ data: po }, { data: company }, { data: lines }] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("*, parties(legal_name, billing_address, ntn, strn), warehouses(name)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("company").select("*").maybeSingle(),
    supabase.from("purchase_order_lines").select("*").eq("purchase_order_id", id).order("sort_order"),
  ]);

  if (!po) notFound();

  const { logoUrl, signatureUrl, stampUrl } = await getCompanyBrandingUrls(supabase, company, {
    signature: signature === "1",
    stamp: stamp === "1",
  });

  const supplier = po.parties as unknown as { legal_name: string; billing_address: string | null; ntn: string | null; strn: string | null } | null;
  const warehouse = po.warehouses as unknown as { name: string } | null;

  return (
    <>
      {autoprint !== "0" && <PrintBackLink href={`/purchase-orders/${id}`} />}
      <div className="print-po">
        <style dangerouslySetInnerHTML={{ __html: printStyles("print-po") }} />

        <PrintWatermark logoUrl={logoUrl} />

        <div className="hdr">
          <PrintLogoBlock company={company} logoUrl={logoUrl} showPhone={phone === "1"} showEmail={email === "1"} />
          <div style={{ textAlign: "right" }}>
            <h1>PURCHASE ORDER</h1>
            <div className="muted">{po.po_no}</div>
            <div className="muted">{new Date(po.created_at).toLocaleDateString("en-PK")}</div>
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
            <div className="muted">Type</div>
            <div>{TYPE_LABEL[po.purchase_type] ?? po.purchase_type}</div>
            {warehouse && <div className="muted">Deliver To: {warehouse.name}</div>}
            {po.expected_delivery && <div className="muted">Expected: {po.expected_delivery}</div>}
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
                <td className="num">{l.ordered_qty}</td>
                <td>{l.unit ?? "—"}</td>
                <td className="num">{l.rate}</td>
                <td className="num">{l.tax_pct}%</td>
                <td className="num">{l.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="totals">
          <span>Subtotal: {po.subtotal}</span>
          <span>Tax: {po.tax_total}</span>
          <span className="grand">
            Total: {po.grand_total} {company?.base_currency}
          </span>
        </div>

        <PrintSignoff ourLabel="Authorized By" theirLabel="Supplier Acknowledgement" signatureUrl={signatureUrl} stampUrl={stampUrl} />

        <script dangerouslySetInnerHTML={{ __html: AUTO_PRINT_SCRIPT }} />
      </div>
    </>
  );
}
