import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { printStyles, AUTO_PRINT_SCRIPT } from "@/lib/printStyles";
import { getCompanyBrandingUrls } from "@/lib/companyBranding";
import { PrintLogoBlock } from "@/components/PrintLogoBlock";
import { PrintFooter } from "@/components/PrintFooter";
import { PrintWatermark } from "@/components/PrintWatermark";
import { PrintSignoff } from "@/components/PrintSignoff";
import { PrintBackLink } from "@/components/PrintBackLink";
import type { Metadata } from "next";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: dc } = await supabase.from("delivery_challans").select("dc_no").eq("id", id).maybeSingle();
  return { title: dc?.dc_no ?? "Delivery Challan" };
}

export default async function DeliveryChallanPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ signature?: string; stamp?: string; phone?: string; email?: string; autoprint?: string }>;
}) {
  const { id } = await params;
  const { signature, stamp, phone, email, autoprint } = await searchParams;
  const supabase = await createClient();

  const [{ data: dc }, { data: company }, { data: lines }] = await Promise.all([
    supabase
      .from("delivery_challans")
      .select("*, parties(legal_name, billing_address, ntn, strn), sales_orders(so_no, client_po_number), warehouses(name)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("company").select("*").maybeSingle(),
    supabase.from("delivery_challan_lines").select("*").eq("dc_id", id).order("sort_order"),
  ]);

  if (!dc) notFound();

  const { logoUrl, signatureUrl, stampUrl } = await getCompanyBrandingUrls(supabase, company, {
    signature: signature === "1",
    stamp: stamp === "1",
  });

  const party = dc.parties as unknown as { legal_name: string; billing_address: string | null; ntn: string | null; strn: string | null } | null;
  const so = dc.sales_orders as unknown as { so_no: string; client_po_number: string } | null;
  const warehouse = dc.warehouses as unknown as { name: string } | null;

  return (
    <>
      {autoprint !== "0" && <PrintBackLink href={`/delivery-challans/${id}`} />}
      <div className="print-dc">
        <style dangerouslySetInnerHTML={{ __html: printStyles("print-dc") }} />

        <PrintWatermark logoUrl={logoUrl} />

        <div className="hdr">
          <PrintLogoBlock company={company} logoUrl={logoUrl} showPhone={phone === "1"} showEmail={email === "1"} />
          <div style={{ textAlign: "right" }}>
            <h1>DELIVERY CHALLAN</h1>
            <div className="muted">{dc.dc_no}</div>
            <div className="muted">{dc.delivery_date}</div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
          <div>
            <div className="muted">Deliver To</div>
            <div style={{ fontWeight: 600 }}>{party?.legal_name}</div>
            {party?.billing_address && <div className="muted">{party.billing_address}</div>}
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="muted">Sales Order</div>
            <div>{so?.so_no}</div>
            {so?.client_po_number && <div className="muted">PO: {so.client_po_number}</div>}
            <div className="muted">Ex-Warehouse: {warehouse?.name}</div>
            {dc.vehicle_no && <div className="muted">Vehicle: {dc.vehicle_no}</div>}
            {dc.driver_name && <div className="muted">Driver: {dc.driver_name}</div>}
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th className="num">Delivered Qty</th>
              <th>Unit</th>
            </tr>
          </thead>
          <tbody>
            {(lines ?? []).map((l) => (
              <tr key={l.id}>
                <td>{l.description}</td>
                <td className="num">{l.delivered_qty}</td>
                <td>{l.unit ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {dc.remarks && (
          <p className="muted" style={{ marginTop: 12 }}>
            Remarks: {dc.remarks}
          </p>
        )}

        <PrintSignoff
          ourLabel="Dispatched By"
          theirLabel="Received By (Name, Signature & Date)"
          signatureUrl={signatureUrl}
          stampUrl={stampUrl}
        />

        <PrintFooter />

        <script dangerouslySetInnerHTML={{ __html: AUTO_PRINT_SCRIPT }} />
      </div>
    </>
  );
}
