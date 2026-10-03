import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { CompleteServiceJobButton } from "@/components/CompleteServiceJobButton";
import { CancelWithReasonButton } from "@/components/CancelWithReasonButton";
import { NewServiceDeliveryForm } from "@/components/NewServiceDeliveryForm";
import { NewServiceInvoiceForm } from "@/components/NewServiceInvoiceForm";
import { cancelServiceJobAction, cancelServiceDeliveryAction, cancelServiceInvoiceAction } from "@/app/actions/serviceJobs";

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

  const supabase = await createClient();
  const [{ data: job }, { data: deliveries }, { data: invoices }] = await Promise.all([
    supabase.from("service_jobs").select("*, parties(legal_name, billing_address)").eq("id", id).maybeSingle(),
    supabase.from("service_deliveries").select("*").eq("service_job_id", id).order("created_at", { ascending: false }),
    supabase.from("service_invoices").select("*, service_invoice_lines(*)").eq("service_job_id", id).order("created_at", { ascending: false }),
  ]);

  if (!job) notFound();

  const party = job.parties as unknown as { legal_name: string; billing_address: string | null } | null;
  const canComplete = canManageJob && job.status === "Received";
  const canCancelJob = canManageJob && job.status !== "Cancelled" && !deliveries?.some((d) => d.status !== "Cancelled") && !invoices?.some((i) => i.status !== "Cancelled");
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
                <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Client&apos;s DC</p>
                <p className="text-ink mt-0.5">{job.customer_dc_no ?? "—"} {job.customer_dc_date && `(${job.customer_dc_date})`}</p>
              </div>
            </div>
            {job.received_condition_notes && (
              <div>
                <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Condition on Receipt</p>
                <p className="text-ink-soft mt-0.5">{job.received_condition_notes}</p>
              </div>
            )}
          </div>

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
                    {canManageDelivery && d.status !== "Cancelled" && (
                      <CancelWithReasonButton label="Cancel this Delivery" onCancel={(reason) => cancelServiceDeliveryAction(d.id, id, reason)} />
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
                        <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${inv.status === "Cancelled" ? "bg-bad-soft text-bad" : "bg-good-soft text-good"}`}>{inv.status}</span>
                      </div>
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
                      {canManageInvoice && inv.status !== "Cancelled" && (
                        <CancelWithReasonButton label="Cancel this Invoice" onCancel={(reason) => cancelServiceInvoiceAction(inv.id, id, reason)} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {canInvoice && <NewServiceInvoiceForm serviceJobId={id} />}
        </div>

        <div className="space-y-6">
          {(canComplete || canCancelJob) && (
            <div className="rounded-xl border border-line bg-surface p-4 space-y-2">
              <h2 className="text-sm font-semibold text-ink mb-2">Actions</h2>
              {canComplete && <CompleteServiceJobButton serviceJobId={id} />}
              {canCancelJob && <CancelWithReasonButton label="Cancel Service Job" onCancel={(reason) => cancelServiceJobAction(id, reason)} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
