import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { JobMaterialPanel } from "@/components/JobMaterialPanel";
import { JobStatusPanel } from "@/components/JobStatusPanel";
import { AttachmentsPanel } from "@/components/AttachmentsPanel";
import { TasksPanel } from "@/components/TasksPanel";

const STATUS_STYLE: Record<string, string> = {
  MaterialPending: "bg-warn-soft text-warn",
  MaterialAvailable: "bg-ledger-soft text-ledger",
  FabricationStarted: "bg-accent-soft text-accent-ink",
  InProcess: "bg-accent-soft text-accent-ink",
  ReadyForDispatch: "bg-good-soft text-good",
  Delivered: "bg-good-soft text-good",
  Cancelled: "bg-bad-soft text-bad",
};

const STATUS_LABEL: Record<string, string> = {
  MaterialPending: "Material Pending",
  MaterialAvailable: "Material Available",
  FabricationStarted: "Fabrication Started",
  InProcess: "In Process",
  ReadyForDispatch: "Ready for Dispatch",
  Delivered: "Delivered",
  Cancelled: "Cancelled",
};

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const canManageJob = isOwner(user) || hasRole(user, "production");
  const canHandleMaterial = canManageJob || hasRole(user, "store");

  const supabase = await createClient();
  const [
    { data: job },
    { data: requirements },
    { data: reservations },
    { data: costLedger },
    { data: notes },
    { data: attachments },
    { data: tasks },
    { data: profiles },
  ] = await Promise.all([
    supabase
      .from("jobs")
      .select("*, sales_orders(so_no, client_po_number, parties(legal_name)), warehouses(name), product_templates(template_code, name), profiles(full_name)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("job_material_requirements").select("*, items(item_code, description, base_unit)").eq("job_id", id),
    supabase.from("stock_reservations").select("*, items(item_code, description)").eq("job_id", id).order("created_at", { ascending: false }),
    supabase.from("job_cost_ledger").select("*").eq("job_id", id).order("created_at", { ascending: false }),
    supabase.from("activity_timeline").select("*").eq("owner_table", "jobs").eq("owner_id", id).order("at", { ascending: false }),
    supabase.from("attachments").select("*").eq("owner_table", "jobs").eq("owner_id", id).order("uploaded_at", { ascending: false }),
    supabase.from("tasks").select("*, profiles(full_name)").eq("related_table", "jobs").eq("related_id", id).order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
  ]);

  if (!job) notFound();

  const itemIds = (requirements ?? []).map((r) => r.item_id);
  const { data: availability } = itemIds.length
    ? await supabase.from("stock_availability").select("*").eq("warehouse_id", job.warehouse_id).in("item_id", itemIds)
    : { data: [] as { item_id: string | null; free_qty: number | null }[] };

  const freeByItem = new Map((availability ?? []).map((a) => [a.item_id, a.free_qty ?? 0]));

  const so = job.sales_orders as unknown as { so_no: string; client_po_number: string; parties: { legal_name: string } | null } | null;
  const warehouse = job.warehouses as unknown as { name: string } | null;
  const template = job.product_templates as unknown as { template_code: string; name: string } | null;
  const responsible = job.profiles as unknown as { full_name: string } | null;

  const materialCost = (costLedger ?? []).filter((c) => c.cost_type === "material").reduce((s, c) => s + c.amount, 0);
  const labourCost = (costLedger ?? []).filter((c) => c.cost_type === "labour").reduce((s, c) => s + c.amount, 0);
  const overheadCost = (costLedger ?? []).filter((c) => c.cost_type === "overhead").reduce((s, c) => s + c.amount, 0);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/jobs" className="text-xs text-ink-faint hover:text-ink">
          ← Jobs
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold text-ink font-mono">{job.job_no}</h1>
          <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[job.status] ?? ""}`}>{STATUS_LABEL[job.status] ?? job.status}</span>
          <span className="text-xs text-ink-faint tabular">{job.progress_pct}% complete</span>
        </div>
        <p className="text-sm text-ink-soft mt-0.5">
          {so?.parties?.legal_name} — SO {so?.so_no} (PO: {so?.client_po_number})
        </p>
      </div>

      {job.status === "Cancelled" && job.cancel_reason && (
        <div className="rounded-md bg-bad-soft border border-bad px-4 py-2 text-sm text-bad">Cancel wajah: {job.cancel_reason}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-xl border border-line bg-surface p-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Description</p>
              <p className="text-ink mt-0.5">{job.description}</p>
            </div>
            <div>
              <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Job Qty</p>
              <p className="text-ink mt-0.5 tabular">{job.job_qty}</p>
            </div>
            <div>
              <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Warehouse</p>
              <p className="text-ink mt-0.5">{warehouse?.name ?? "—"}</p>
            </div>
            {template && (
              <div>
                <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">BOM Template</p>
                <p className="text-ink mt-0.5">
                  <Link href={`/product-templates/${job.product_template_id}`} className="text-accent-ink underline underline-offset-2">
                    {template.template_code}
                  </Link>
                </p>
              </div>
            )}
            {responsible && (
              <div>
                <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Responsible</p>
                <p className="text-ink mt-0.5">{responsible.full_name}</p>
              </div>
            )}
            {job.required_delivery_date && (
              <div>
                <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Required Delivery</p>
                <p className="text-ink mt-0.5">{job.required_delivery_date}</p>
              </div>
            )}
          </div>

          <JobMaterialPanel
            jobId={id}
            jobStatus={job.status}
            warehouseId={job.warehouse_id}
            requirements={(requirements ?? []).map((r) => ({
              id: r.id,
              item_id: r.item_id,
              required_qty: r.required_qty,
              reserved_qty: r.reserved_qty,
              issued_qty: r.issued_qty,
              returned_qty: r.returned_qty,
              unit: r.unit,
              item: r.items as unknown as { item_code: string; description: string; base_unit: string } | null,
              free_qty: freeByItem.get(r.item_id) ?? 0,
            }))}
            reservations={(reservations ?? []).map((r) => ({
              id: r.id,
              item_id: r.item_id,
              reserved_qty: r.reserved_qty,
              reservation_mode: r.reservation_mode,
              status: r.status,
              item: r.items as unknown as { item_code: string; description: string } | null,
            }))}
            canHandleMaterial={canHandleMaterial}
          />

          <div className="rounded-xl border border-line bg-surface p-4 space-y-2">
            <h2 className="text-sm font-semibold text-ink">Job Cost Summary</h2>
            <div className="grid grid-cols-3 gap-3 text-sm tabular">
              <div>
                <p className="text-xs text-ink-faint">Material</p>
                <p className="text-ink font-medium">{materialCost.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-ink-faint">Labour</p>
                <p className="text-ink font-medium">{labourCost.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-ink-faint">Overhead</p>
                <p className="text-ink font-medium">{overheadCost.toLocaleString()}</p>
              </div>
            </div>
            <p className="text-xs text-ink-faint">
              Sirf material cost automated hai (stock issue/return se). Labour/overhead abhi manual expense/payroll system na hone ki wajah se automated nahi
              — yeh ek jaana-bujha scope deferral hai.
            </p>
          </div>

          {!!notes?.length && (
            <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
              <h2 className="text-sm font-semibold text-ink">Activity / Notes</h2>
              <ul className="space-y-2 text-sm">
                {notes.map((n) => (
                  <li key={n.id} className="border-t border-line pt-2 first:border-t-0 first:pt-0">
                    <p className="text-ink">{n.note}</p>
                    <p className="text-xs text-ink-faint mt-0.5">{new Date(n.at).toLocaleString("en-PK")}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <JobStatusPanel jobId={id} status={job.status} progressPct={job.progress_pct} canManage={canManageJob} />

          <div className="rounded-xl border border-line bg-surface p-4 space-y-2">
            <h2 className="text-sm font-semibold text-ink mb-1">Tasks &amp; Follow-ups</h2>
            <TasksPanel
              relatedTable="jobs"
              relatedId={id}
              revalidateTo={`/jobs/${id}`}
              tasks={(tasks ?? []).map((t) => ({
                id: t.id,
                title: t.title,
                due_date: t.due_date,
                priority: t.priority,
                status: t.status,
                assigned_to: t.assigned_to,
                assignee_name: (t.profiles as unknown as { full_name: string } | null)?.full_name ?? "—",
                created_by: t.created_by,
              }))}
              profiles={profiles ?? []}
              currentUserId={user?.id ?? ""}
              isOwnerUser={isOwner(user)}
              canAdd={!!user}
            />
          </div>

          <div className="rounded-xl border border-line bg-surface p-4 space-y-2">
            <h2 className="text-sm font-semibold text-ink mb-1">Attachments</h2>
            <AttachmentsPanel ownerTable="jobs" ownerId={id} revalidateTo={`/jobs/${id}`} attachments={attachments ?? []} canManage={canManageJob} />
          </div>
        </div>
      </div>
    </div>
  );
}
