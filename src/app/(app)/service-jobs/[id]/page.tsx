import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, hasRole, isOwner } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { CompleteServiceJobButton } from "@/components/CompleteServiceJobButton";
import { CancelWithReasonButton } from "@/components/CancelWithReasonButton";
import { NewServiceDeliveryForm } from "@/components/NewServiceDeliveryForm";
import { NewServiceInvoiceForm } from "@/components/NewServiceInvoiceForm";
import { PrintPdfActions } from "@/components/PrintPdfActions";
import { InlineFieldEdit } from "@/components/InlineFieldEdit";
import { ServiceMaterialForm } from "@/components/ServiceMaterialForm";
import { costHeading, summarizeMaterial } from "@/lib/serviceMaterial";
import {
  cancelServiceJobAction,
  cancelServiceDeliveryAction,
  cancelServiceInvoiceAction,
  cancelServiceMaterialDocAction,
  updateServiceJobDcNoAction,
} from "@/app/actions/serviceJobs";

const JOB_STATUS_STYLE: Record<string, string> = {
  Received: "bg-warn-soft text-warn",
  Completed: "bg-ledger-soft text-ledger",
  Delivered: "bg-good-soft text-good",
  Cancelled: "bg-bad-soft text-bad",
};

export default async function ServiceJobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const canManageJob = await hasPermission(user, "service_job.manage");
  const canManageDelivery = await hasPermission(user, "service_delivery.manage");
  const canManageInvoice = await hasPermission(user, "service_invoice.manage");
  const canManageMaterial = await hasPermission(user, "service_material.manage");
  // The cost ledger is finance-only in the database; the panel is hidden for everyone else.
  const canSeeCost = isOwner(user) || hasRole(user, "accounts") || hasRole(user, "auditor");

  const supabase = await createClient();
  const [{ data: job }, { data: deliveries }, { data: invoices }, { data: company }, { data: materialDocs }, { data: costLedger }, { data: warehouses }] = await Promise.all([
    supabase.from("service_jobs").select("*, parties(legal_name, billing_address)").eq("id", id).maybeSingle(),
    supabase.from("service_deliveries").select("*").eq("service_job_id", id).order("created_at", { ascending: false }),
    supabase.from("service_invoices").select("*, service_invoice_lines(*)").eq("service_job_id", id).order("created_at", { ascending: false }),
    supabase.from("company").select("signature_path, stamp_path").maybeSingle(),
    supabase
      .from("service_material_docs")
      .select("*, service_material_lines(item_id, description, qty, unit, sort_order)")
      .eq("service_job_id", id)
      .order("created_at", { ascending: false }),
    canSeeCost ? supabase.from("service_job_cost_ledger").select("item_id, amount").eq("service_job_id", id) : Promise.resolve({ data: null }),
    supabase.from("warehouses").select("id, name").eq("is_active", true).order("name"),
  ]);

  if (!job) notFound();

  // A job raised from a client PO on a quotation: which quotation, and the service lines that were quoted.
  const { data: fromQuotation } = job.quotation_id
    ? await supabase.from("quotations").select("id, quotation_no").eq("id", job.quotation_id).maybeSingle()
    : { data: null };
  const quotedLines = (Array.isArray(job.quoted_lines) ? job.quoted_lines : []) as {
    description?: string;
    qty?: number;
    unit?: string | null;
    rate?: number;
  }[];

  const party = job.parties as unknown as { legal_name: string; billing_address: string | null } | null;
  const canComplete = canManageJob && job.status === "Received";
  const material = summarizeMaterial(materialDocs ?? [], canSeeCost ? costLedger ?? [] : null);
  const materialOut = material.netQty !== 0;
  const canCancelJob =
    isOwner(user) && job.status !== "Cancelled" && !deliveries?.some((d) => d.status !== "Cancelled") && !invoices?.some((i) => i.status !== "Cancelled") && !materialOut;
  const canIssueMaterial = canManageMaterial && (job.status === "Received" || job.status === "Completed");
  const invoicedExGst = (invoices ?? []).filter((i) => i.status !== "Cancelled").reduce((t, i) => t + Number(i.subtotal), 0);
  const canDeliver = canManageDelivery && job.status === "Completed";
  const canInvoice = canManageInvoice && job.status !== "Cancelled";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href="/service-jobs" className="text-xs text-ink-faint hover:text-ink">
            ← Service Jobs
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-lg font-semibold text-ink font-mono">{job.job_no}</h1>
            <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${JOB_STATUS_STYLE[job.status] ?? ""}`}>{job.status}</span>
          </div>
          <p className="text-sm text-ink-soft mt-0.5">{party?.legal_name}</p>
          {job.client_po_no && <p className="text-xs text-ink-faint mt-0.5">Client PO: <span className="font-mono">{job.client_po_no}</span></p>}
        </div>
      </div>

      {job.status === "Cancelled" && job.cancel_reason && (
        <div className="rounded-md bg-bad-soft border border-bad px-4 py-2 text-sm text-bad">Cancel reason: {job.cancel_reason}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl border border-line bg-surface p-4 space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Machine/Part</p>
                <p className="text-ink mt-0.5">{job.asset_description}</p>
              </div>
              <div>
                {canManageJob ? (
                  <InlineFieldEdit
                    label="Client's DC"
                    value={job.customer_dc_no}
                    onSave={updateServiceJobDcNoAction.bind(null, id, job.customer_dc_no)}
                  />
                ) : (
                  <>
                    <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Client&apos;s DC</p>
                    <p className="text-ink mt-0.5">{job.customer_dc_no ?? "—"}</p>
                  </>
                )}
                {job.customer_dc_date && <p className="text-xs text-ink-faint mt-0.5">({job.customer_dc_date})</p>}
              </div>
            </div>
            {fromQuotation && (
              <div>
                <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">From Quotation</p>
                <Link href={`/quotations/${fromQuotation.id}`} className="mt-0.5 inline-block font-mono text-xs text-accent-ink underline underline-offset-2">
                  {fromQuotation.quotation_no}
                </Link>
                {quotedLines.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs text-ink-soft">
                    {quotedLines.map((l, i) => (
                      <li key={i} className="whitespace-pre-line">
                        {l.description} — {l.qty} {l.unit ?? ""} @ {Number(l.rate ?? 0).toLocaleString()}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {job.received_condition_notes && (
              <div>
                <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Condition on Receipt</p>
                <p className="text-ink-soft mt-0.5">{job.received_condition_notes}</p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-ink">Material for Site (DC)</h2>
            {!!materialDocs?.length && (
              <div className="rounded-xl border border-line bg-surface overflow-hidden divide-y divide-line">
                {materialDocs.map((d) => {
                  const dl = [...(d.service_material_lines as unknown as { item_id: string; description: string; qty: number; unit: string | null; sort_order: number }[])].sort(
                    (a, b) => a.sort_order - b.sort_order
                  );
                  return (
                    <div key={d.id} className="px-4 py-2.5 text-sm space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs">
                          <span className="font-mono text-ink">{d.doc_no}</span>{" "}
                          <span className="text-ink-faint">{d.kind === "issue" ? "Issued to site" : "Returned from site"}</span>
                        </span>
                        <div className="flex items-center gap-3">
                          {d.kind === "issue" && d.status !== "Cancelled" && (
                            <PrintPdfActions
                              printPath={`/service-material/${d.id}/print`}
                              filename={`${d.doc_no}.pdf`}
                              hasSignature={!!company?.signature_path}
                              hasStamp={!!company?.stamp_path}
                              hasPhone={false}
                              hasEmail={false}
                            />
                          )}
                          <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${d.status === "Cancelled" ? "bg-bad-soft text-bad" : "bg-good-soft text-good"}`}>{d.status}</span>
                        </div>
                      </div>
                      <p className="text-xs text-ink-faint">
                        {d.doc_date} {d.vehicle_no && `· ${d.vehicle_no}`} {d.driver_name && `· ${d.driver_name}`} {d.remarks && `· ${d.remarks}`}
                      </p>
                      <ul className="text-xs text-ink-soft space-y-0.5">
                        {dl.map((l, i) => (
                          <li key={i}>
                            {l.description} — {Number(l.qty)} {l.unit ?? ""}
                          </li>
                        ))}
                      </ul>
                      {d.status === "Cancelled" && d.cancel_reason && <p className="text-xs text-bad">Reason: {d.cancel_reason}</p>}
                      {isOwner(user) && d.status !== "Cancelled" && (job.status === "Received" || job.status === "Completed") && (
                        <CancelWithReasonButton label="Cancel this document" onCancel={cancelServiceMaterialDocAction.bind(null, d.id, id)} />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {!materialDocs?.length && <p className="text-xs text-ink-faint">No material issued to this job yet.</p>}
            {canIssueMaterial && <ServiceMaterialForm serviceJobId={id} warehouses={warehouses ?? []} />}
            {materialOut && <p className="text-xs text-warn">Material is still out on this job. Record what comes back before cancelling the job.</p>}
          </div>

          {canSeeCost && material.rows.length > 0 && (
            <div className="rounded-xl border border-line bg-surface overflow-hidden">
              <h2 className="px-4 pt-3 text-sm font-semibold text-ink">{costHeading(job.status)}</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm mt-2">
                  <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
                    <tr>
                      <th className="text-left px-4 py-2">Material</th>
                      <th className="text-right px-4 py-2">Issued</th>
                      <th className="text-right px-4 py-2">Returned</th>
                      <th className="text-right px-4 py-2">On job</th>
                      <th className="text-right px-4 py-2">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {material.rows.map((r) => (
                      <tr key={r.item_id} className="border-t border-line">
                        <td className="px-4 py-2">{r.description}</td>
                        <td className="px-4 py-2 text-right tabular">{r.issued}</td>
                        <td className="px-4 py-2 text-right tabular">{r.returned || "—"}</td>
                        <td className="px-4 py-2 text-right tabular">{r.net}</td>
                        <td className="px-4 py-2 text-right tabular">{(r.cost ?? 0).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-line-strong bg-surface-2 font-medium">
                    <tr>
                      <td className="px-4 py-2" colSpan={4}>
                        {job.status === "Delivered" ? "Total Cost" : "Cost so far"}
                      </td>
                      <td className="px-4 py-2 text-right tabular">{(material.totalCost ?? 0).toLocaleString()}</td>
                    </tr>
                    {invoicedExGst > 0 && (
                      <>
                        <tr>
                          <td className="px-4 py-2 text-ink-soft font-normal" colSpan={4}>
                            Invoiced (without GST)
                          </td>
                          <td className="px-4 py-2 text-right tabular font-normal">{invoicedExGst.toLocaleString()}</td>
                        </tr>
                        <tr>
                          <td className="px-4 py-2 text-ink-soft font-normal" colSpan={4}>
                            Invoiced minus material cost
                          </td>
                          <td className="px-4 py-2 text-right tabular font-normal">{(invoicedExGst - (material.totalCost ?? 0)).toLocaleString()}</td>
                        </tr>
                      </>
                    )}
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {!!deliveries?.length && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-ink">Service Deliveries</h2>
              <div className="rounded-xl border border-line bg-surface overflow-hidden divide-y divide-line">
                {deliveries.map((d) => (
                  <div key={d.id} className="px-4 py-2.5 text-sm space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-ink">{d.delivery_no}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${d.status === "Cancelled" ? "bg-bad-soft text-bad" : "bg-good-soft text-good"}`}>{d.status}</span>
                    </div>
                    <p className="text-xs text-ink-faint">
                      {d.delivery_date} {d.vehicle_no && `· ${d.vehicle_no}`} {d.driver_name && `· ${d.driver_name}`}
                    </p>
                    {d.status === "Cancelled" && d.cancel_reason && <p className="text-xs text-bad">Reason: {d.cancel_reason}</p>}
                    {isOwner(user) && d.status !== "Cancelled" && (
                      <CancelWithReasonButton label="Cancel this Delivery" onCancel={cancelServiceDeliveryAction.bind(null, d.id, id)} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {canDeliver && <NewServiceDeliveryForm serviceJobId={id} />}

          {!!invoices?.length && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-ink">Service Invoices</h2>
              <div className="rounded-xl border border-line bg-surface overflow-hidden divide-y divide-line">
                {invoices.map((inv) => {
                  const lines = inv.service_invoice_lines as unknown as { id: string; description: string; qty: number; rate: number; tax_pct: number; amount: number }[];
                  return (
                    <div key={inv.id} className="px-4 py-2.5 text-sm space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs text-ink">{inv.invoice_no}</span>
                        <div className="flex items-center gap-3">
                          {inv.status !== "Cancelled" && (
                            <PrintPdfActions
                              printPath={`/service-invoices/${inv.id}/print`}
                              filename={`${inv.invoice_no}.pdf`}
                              hasSignature={!!company?.signature_path}
                              hasStamp={!!company?.stamp_path}
                              hasPhone={false}
                              hasEmail={false}
                            />
                          )}
                          <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${inv.status === "Cancelled" ? "bg-bad-soft text-bad" : "bg-good-soft text-good"}`}>{inv.status}</span>
                        </div>
                      </div>
                      {inv.client_po_no && <p className="text-xs text-ink-soft">Client PO: {inv.client_po_no}</p>}
                      <ul className="text-xs text-ink-soft space-y-0.5">
                        {lines.map((l) => (
                          <li key={l.id} className="flex justify-between">
                            <span>{l.description} ({l.qty} × {l.rate})</span>
                            <span className="tabular">{l.amount}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="text-xs text-ink-faint">{inv.invoice_date} · Total: {inv.grand_total.toLocaleString()}</p>
                      {inv.status === "Cancelled" && inv.cancel_reason && <p className="text-xs text-bad">Reason: {inv.cancel_reason}</p>}
                      {isOwner(user) && inv.status !== "Cancelled" && (
                        <CancelWithReasonButton label="Cancel this Invoice" onCancel={cancelServiceInvoiceAction.bind(null, inv.id, id)} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {canInvoice && <NewServiceInvoiceForm serviceJobId={id} jobPoNo={job.client_po_no} />}
        </div>

        <div className="space-y-6">
          {(canComplete || canCancelJob) && (
            <div className="rounded-xl border border-line bg-surface p-4 space-y-2">
              <h2 className="text-sm font-semibold text-ink mb-2">Actions</h2>
              {canComplete && <CompleteServiceJobButton serviceJobId={id} />}
              {canCancelJob && <CancelWithReasonButton label="Cancel Service Job" onCancel={cancelServiceJobAction.bind(null, id)} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
