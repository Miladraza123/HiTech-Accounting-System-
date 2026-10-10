import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { canSeeFinance } from "@/lib/financeAccess";
import { printStyles, AUTO_PRINT_SCRIPT } from "@/lib/printStyles";
import { getCompanyBrandingUrls } from "@/lib/companyBranding";
import { PrintLogoBlock } from "@/components/PrintLogoBlock";
import { PrintFooter } from "@/components/PrintFooter";
import { PrintWatermark } from "@/components/PrintWatermark";
import { PrintSignoff } from "@/components/PrintSignoff";
import { PrintBackLink } from "@/components/PrintBackLink";
import type { Metadata } from "next";

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ so_id?: string }> }): Promise<Metadata> {
  const { so_id } = await searchParams;
  if (!so_id) return { title: "Order-wise Status" };
  const supabase = await createClient();
  const { data: so } = await supabase.from("sales_orders").select("so_no").eq("id", so_id).maybeSingle();
  return { title: so ? `Order Status — ${so.so_no}` : "Order-wise Status" };
}

type StageItem = { label: string; status: string };

export default async function OrderStatusPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ so_id?: string; signature?: string; stamp?: string; phone?: string; email?: string; autoprint?: string }>;
}) {
  const { so_id, signature, stamp, phone, email, autoprint } = await searchParams;
  if (!so_id) notFound();

  const supabase = await createClient();
  const [user, { data: company }, { data: so }] = await Promise.all([
    getCurrentUser(),
    supabase.from("company").select("*").maybeSingle(),
    supabase
      .from("sales_orders")
      .select("*, queries(query_no, status), quotations(quotation_no, status)")
      .eq("id", so_id)
      .maybeSingle(),
  ]);

  if (!so) notFound();

  const [{ data: jobs }, { data: dcs }, { data: invoices }] = await Promise.all([
    supabase.from("jobs").select("job_no, status").eq("sales_order_id", so_id),
    supabase.from("delivery_challans").select("dc_no, status, acceptance_status").eq("sales_order_id", so_id),
    supabase.from("invoices").select("id, invoice_no, status, grand_total").eq("sales_order_id", so_id),
  ]);

  const invoiceIds = (invoices ?? []).map((i) => i.id);
  const financeView = canSeeFinance(user);
  const { data: allocations } =
    financeView && invoiceIds.length
      ? await supabase.from("payment_allocations").select("amount, payments(payment_no, payment_date, status)").in("invoice_id", invoiceIds)
      : { data: [] };
  const { data: received } =
    !financeView && invoiceIds.length
      ? await supabase.from("invoice_outstanding").select("invoice_id, allocated_amount, outstanding_amount").in("invoice_id", invoiceIds)
      : { data: [] };
  const invoiceNoById = new Map((invoices ?? []).map((i) => [i.id, i.invoice_no]));

  const payments: StageItem[] = financeView
    ? (allocations ?? [])
        .map((a) => {
          const pay = a.payments as unknown as { payment_no: string; payment_date: string; status: string } | null;
          return pay && pay.status === "Posted" ? { label: `${pay.payment_no} (${pay.payment_date})`, status: a.amount.toLocaleString() } : null;
        })
        .filter((p): p is StageItem => p !== null)
    : (received ?? [])
        .filter((r) => (r.allocated_amount ?? 0) > 0)
        .map((r) => ({
          label: `${invoiceNoById.get(r.invoice_id ?? "") ?? "Invoice"} — received ${(r.allocated_amount ?? 0).toLocaleString()}`,
          status: `Outstanding ${(r.outstanding_amount ?? 0).toLocaleString()}`,
        }));

  const query = so.queries as unknown as { query_no: string; status: string } | null;
  const quotation = so.quotations as unknown as { quotation_no: string; status: string } | null;

  const { logoUrl, signatureUrl, stampUrl } = await getCompanyBrandingUrls(supabase, company, {
    signature: signature === "1",
    stamp: stamp === "1",
  });

  const sections: { title: string; items: StageItem[]; empty: string }[] = [
    { title: "Query", items: query ? [{ label: query.query_no, status: query.status }] : [], empty: "No Query linked." },
    { title: "Quotation", items: quotation ? [{ label: quotation.quotation_no, status: quotation.status }] : [], empty: "No Quotation linked." },
    {
      title: "Sales Order",
      items: [{ label: `${so.so_no} — ${(so.grand_total ?? 0).toLocaleString()}`, status: so.status }],
      empty: "—",
    },
    ...(so.business_line === "fabrication"
      ? [{ title: "Fabrication Jobs", items: (jobs ?? []).map((j) => ({ label: j.job_no, status: j.status })), empty: "No Job created yet." }]
      : []),
    {
      title: "Delivery Challans",
      items: (dcs ?? []).map((d) => ({ label: d.dc_no, status: `${d.status} / ${d.acceptance_status}` })),
      empty: "No Delivery Challan created yet.",
    },
    {
      title: "Invoices",
      items: (invoices ?? []).map((i) => ({ label: i.invoice_no, status: `${i.grand_total.toLocaleString()} — ${i.status}` })),
      empty: "No Invoice created yet.",
    },
    { title: "Payments", items: payments, empty: "No Payment allocated yet." },
  ];

  return (
    <>
      {autoprint !== "0" && <PrintBackLink href={`/reports/order-status?so_id=${so_id}`} />}
      <div className="print-ostat">
        <style dangerouslySetInnerHTML={{ __html: printStyles("print-ostat") }} />

        <PrintWatermark logoUrl={logoUrl} />

        <div className="hdr">
          <PrintLogoBlock company={company} logoUrl={logoUrl} showPhone={phone === "1"} showEmail={email === "1"} />
          <div style={{ textAlign: "right" }}>
            <h1>ORDER-WISE STATUS</h1>
            <div className="muted">{so.so_no}</div>
            <div className="muted">As of {new Date().toISOString().slice(0, 10)}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Stage</th>
              <th>Reference</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((s) =>
              s.items.length ? (
                s.items.map((it, i) => (
                  <tr key={`${s.title}-${i}`}>
                    {i === 0 && <td rowSpan={s.items.length} style={{ fontWeight: 700, verticalAlign: "top" }}>{s.title}</td>}
                    <td>{it.label}</td>
                    <td>{it.status}</td>
                  </tr>
                ))
              ) : (
                <tr key={s.title}>
                  <td style={{ fontWeight: 700 }}>{s.title}</td>
                  <td colSpan={2} className="muted">
                    {s.empty}
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>

        <PrintSignoff ourLabel="Prepared By (Sales)" theirLabel="Verified By (Owner)" signatureUrl={signatureUrl} stampUrl={stampUrl} />

        <PrintFooter />

        <script dangerouslySetInnerHTML={{ __html: AUTO_PRINT_SCRIPT }} />
      </div>
    </>
  );
}
