import { createClient } from "@/lib/supabase/server";
import { printStyles, AUTO_PRINT_SCRIPT } from "@/lib/printStyles";
import { getCompanyBrandingUrls } from "@/lib/companyBranding";
import { PrintLogoBlock } from "@/components/PrintLogoBlock";
import { PrintFooter } from "@/components/PrintFooter";
import { PrintWatermark } from "@/components/PrintWatermark";
import { PrintSignoff } from "@/components/PrintSignoff";
import { PrintBackLink } from "@/components/PrintBackLink";
import type { Metadata } from "next";

// No pagination here, unlike the on-screen report — a printed order list
// must show every matching order, not just one page of it.
const PRINT_LIMIT = 100000;

// "Pending" = not yet invoiced — same definition as the on-screen report.
const DONE_STATUSES = ["Invoiced", "Closed", "Cancelled"];

export const metadata: Metadata = { title: "Company-wise Order List" };

type Row = { id: string; so_no: string; status: string; client_po_number: string; grand_total: number; created_at: string; company: string };

export default async function CompanyOrdersPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; signature?: string; stamp?: string; phone?: string; email?: string; autoprint?: string }>;
}) {
  const { filter: filterParam, signature, stamp, phone, email, autoprint } = await searchParams;
  const filter = filterParam === "all" ? "all" : "pending";

  const supabase = await createClient();
  let query = supabase
    .from("sales_orders")
    .select("id, so_no, status, client_po_number, grand_total, created_at, parties(legal_name)");
  if (filter === "pending") query = query.not("status", "in", `(${DONE_STATUSES.join(",")})`);

  const [{ data: orders }, { data: company }] = await Promise.all([
    query
      .order("legal_name", { referencedTable: "parties" })
      .order("so_no")
      .range(0, PRINT_LIMIT - 1),
    supabase.from("company").select("*").maybeSingle(),
  ]);

  const { logoUrl, signatureUrl, stampUrl } = await getCompanyBrandingUrls(supabase, company, {
    signature: signature === "1",
    stamp: stamp === "1",
  });

  const rows: Row[] = (orders ?? []).map((o) => ({
    id: o.id,
    so_no: o.so_no,
    status: o.status,
    client_po_number: o.client_po_number,
    grand_total: o.grand_total,
    created_at: o.created_at,
    company: (o.parties as unknown as { legal_name: string } | null)?.legal_name ?? "—",
  }));

  // Group consecutive rows under the same company into one heading — rows
  // already arrive sorted by company name, so a run of the same name here
  // is always contiguous.
  const groups: { company: string; rows: Row[] }[] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.company === r.company) last.rows.push(r);
    else groups.push({ company: r.company, rows: [r] });
  }

  const grandTotal = rows.reduce((s, r) => s + r.grand_total, 0);

  return (
    <>
      {autoprint !== "0" && <PrintBackLink href={`/reports/company-orders?filter=${filter}`} />}
      <div className="print-co">
        <style dangerouslySetInnerHTML={{ __html: printStyles("print-co") }} />

        <PrintWatermark logoUrl={logoUrl} />

        <div className="hdr">
          <PrintLogoBlock company={company} logoUrl={logoUrl} showPhone={phone === "1"} showEmail={email === "1"} />
          <div style={{ textAlign: "right" }}>
            <h1>COMPANY-WISE ORDER LIST</h1>
            <div className="muted">{filter === "pending" ? "Pending Only" : "All Orders"}</div>
            <div className="muted">As of {new Date().toISOString().slice(0, 10)}</div>
          </div>
        </div>

        {groups.map((g) => (
          <div key={g.company} style={{ marginBottom: 4 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginTop: 14 }}>{g.company}</div>
            <table style={{ marginTop: 4 }}>
              <thead>
                <tr>
                  <th>SO #</th>
                  <th>Client PO #</th>
                  <th>Date</th>
                  <th className="num">Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.so_no}</td>
                    <td>{r.client_po_number}</td>
                    <td>{new Date(r.created_at).toLocaleDateString("en-PK")}</td>
                    <td className="num">{r.grand_total.toLocaleString()}</td>
                    <td>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {!rows.length && (
          <table>
            <tbody>
              <tr>
                <td style={{ textAlign: "center" }}>
                  {filter === "pending" ? "No pending orders — everything is invoiced, closed, or cancelled." : "No orders found."}
                </td>
              </tr>
            </tbody>
          </table>
        )}

        <div className="totals">
          <span>Orders: {rows.length}</span>
          <span className="grand">Grand Total: {grandTotal.toLocaleString()}</span>
        </div>

        <PrintSignoff ourLabel="Prepared By (Sales)" theirLabel="Verified By (Owner)" signatureUrl={signatureUrl} stampUrl={stampUrl} />

        <PrintFooter />

        <script dangerouslySetInnerHTML={{ __html: AUTO_PRINT_SCRIPT }} />
      </div>
    </>
  );
}
