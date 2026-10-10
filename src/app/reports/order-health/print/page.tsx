import { createClient } from "@/lib/supabase/server";
import { computeHealth, daysSince, HEALTH_LABEL_TEXT } from "@/lib/orderHealth";
import { printStyles, AUTO_PRINT_SCRIPT } from "@/lib/printStyles";
import { getCompanyBrandingUrls } from "@/lib/companyBranding";
import { PrintLogoBlock } from "@/components/PrintLogoBlock";
import { PrintFooter } from "@/components/PrintFooter";
import { PrintWatermark } from "@/components/PrintWatermark";
import { PrintSignoff } from "@/components/PrintSignoff";
import { PrintBackLink } from "@/components/PrintBackLink";
import type { Metadata } from "next";

// No capping here, unlike the on-screen "worst 50" dashboard — a printed
// copy must show every open record, not just the worst of each kind.
const PRINT_LIMIT = 100000;

export const metadata: Metadata = { title: "Order Health & Stage Aging" };

type ApiRow = { id: string; doc_no: string; party_name: string; status: string; promised_date: string | null; updated_at: string };
type Section = { total: number; rows: ApiRow[] };

type Row = {
  id: string;
  docNo: string;
  partyName: string;
  status: string;
  promisedDate: string | null;
  daysInStage: number;
  health: ReturnType<typeof computeHealth>;
};

function HealthTable({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>{title}</div>
      <table style={{ marginTop: 4 }}>
        <thead>
          <tr>
            <th>Doc #</th>
            <th>Party</th>
            <th>Status</th>
            <th>Promised Date</th>
            <th className="num">Days in Stage</th>
            <th>Health</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.docNo}</td>
              <td>{r.partyName}</td>
              <td>{r.status}</td>
              <td>{r.promisedDate ?? "—"}</td>
              <td className="num">{r.daysInStage}</td>
              <td>{r.health ? HEALTH_LABEL_TEXT[r.health.label] : "—"}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={6} style={{ textAlign: "center" }}>
                No open records found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default async function OrderHealthPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ signature?: string; stamp?: string; phone?: string; email?: string; autoprint?: string }>;
}) {
  const { signature, stamp, phone, email, autoprint } = await searchParams;

  const supabase = await createClient();
  const [{ data }, { data: company }] = await Promise.all([
    supabase.rpc("fn_order_health", { p_limit: PRINT_LIMIT }),
    supabase.from("company").select("*").maybeSingle(),
  ]);

  const result = (data ?? null) as {
    delayed_count: number;
    at_risk_count: number;
    stalled_count: number;
    sales_orders: Section;
    purchase_orders: Section;
    jobs: Section;
  } | null;

  const empty: Section = { total: 0, rows: [] };
  const soSection = result?.sales_orders ?? empty;
  const poSection = result?.purchase_orders ?? empty;
  const jobSection = result?.jobs ?? empty;

  function toRows(rows: ApiRow[]): Row[] {
    return rows.map((r) => ({
      id: r.id,
      docNo: r.doc_no,
      partyName: r.party_name,
      status: r.status,
      promisedDate: r.promised_date,
      daysInStage: daysSince(r.updated_at),
      health: computeHealth({ isOpen: true, promisedDate: r.promised_date, updatedAt: r.updated_at }),
    }));
  }

  const soRows = toRows(soSection.rows ?? []);
  const poRows = toRows(poSection.rows ?? []);
  const jobRows = toRows(jobSection.rows ?? []);

  const delayedCount = result?.delayed_count ?? 0;
  const atRiskCount = result?.at_risk_count ?? 0;
  const stalledCount = result?.stalled_count ?? 0;

  const { logoUrl, signatureUrl, stampUrl } = await getCompanyBrandingUrls(supabase, company, {
    signature: signature === "1",
    stamp: stamp === "1",
  });

  return (
    <>
      {autoprint !== "0" && <PrintBackLink href="/reports/order-health" />}
      <div className="print-ohealth">
        <style dangerouslySetInnerHTML={{ __html: printStyles("print-ohealth") }} />

        <PrintWatermark logoUrl={logoUrl} />

        <div className="hdr">
          <PrintLogoBlock company={company} logoUrl={logoUrl} showPhone={phone === "1"} showEmail={email === "1"} />
          <div style={{ textAlign: "right" }}>
            <h1>ORDER HEALTH &amp; STAGE AGING</h1>
            <div className="muted">As of {new Date().toISOString().slice(0, 10)}</div>
          </div>
        </div>

        <div className="muted" style={{ fontSize: 13 }}>
          Delayed: {delayedCount} &nbsp;·&nbsp; At Risk: {atRiskCount} &nbsp;·&nbsp; Stalled: {stalledCount}
        </div>

        <HealthTable title="Sales Orders" rows={soRows} />
        <HealthTable title="Purchase Orders" rows={poRows} />
        <HealthTable title="Jobs" rows={jobRows} />

        <PrintSignoff ourLabel="Prepared By (Accounts)" theirLabel="Verified By (Owner)" signatureUrl={signatureUrl} stampUrl={stampUrl} />

        <PrintFooter />

        <script dangerouslySetInnerHTML={{ __html: AUTO_PRINT_SCRIPT }} />
      </div>
    </>
  );
}
