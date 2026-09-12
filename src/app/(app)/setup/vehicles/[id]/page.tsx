import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { EditVehicleForm } from "@/components/EditVehicleForm";
import { AttachmentsPanel } from "@/components/AttachmentsPanel";

const STATUS_STYLE: Record<string, string> = {
  Active: "bg-good-soft text-good",
  UnderMaintenance: "bg-warn-soft text-warn",
  Retired: "bg-surface-2 text-ink-faint",
  Unassigned: "bg-surface-2 text-ink-faint",
};

export default async function VehicleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const canManage = isOwner(user) || hasRole(user, "accounts");

  const supabase = await createClient();
  const [{ data: vehicle }, { data: profiles }, { data: expenses }, { data: attachments }] = await Promise.all([
    supabase.from("vehicles").select("*, profiles(full_name)").eq("id", id).maybeSingle(),
    supabase.from("profiles").select("*").eq("is_active", true).order("full_name"),
    supabase
      .from("expenses")
      .select("*, expense_heads(name)")
      .eq("vehicle_id", id)
      .order("expense_date", { ascending: false }),
    supabase.from("attachments").select("*").eq("owner_table", "vehicles").eq("owner_id", id).order("uploaded_at", { ascending: false }),
  ]);

  if (!vehicle) notFound();

  const assignee = vehicle.profiles as unknown as { full_name: string } | null;
  const totalExpense = (expenses ?? []).filter((e) => e.status === "Posted").reduce((s, e) => s + e.amount, 0);
  const fuelExpense = (expenses ?? [])
    .filter((e) => e.status === "Posted" && (e.expense_heads as unknown as { name: string } | null)?.name === "Fuel")
    .reduce((s, e) => s + e.amount, 0);
  const distance = vehicle.current_meter_reading - vehicle.opening_meter_reading;
  const costPerKm = distance > 0 ? totalExpense / distance : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/setup/vehicles" className="text-xs text-ink-faint hover:text-ink">
          ← Vehicles
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold text-ink font-mono">{vehicle.vehicle_no}</h1>
          <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[vehicle.status] ?? ""}`}>{vehicle.status}</span>
        </div>
        <p className="text-sm text-ink-soft mt-0.5">
          {vehicle.vehicle_type ?? "—"} {vehicle.make_model && `— ${vehicle.make_model}`}
          {vehicle.registration_no && ` · Reg# ${vehicle.registration_no}`}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl border border-line bg-surface p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Assigned To</p>
              <p className="text-ink mt-0.5">{assignee?.full_name ?? "Unassigned"}</p>
            </div>
            <div>
              <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Meter Reading</p>
              <p className="text-ink mt-0.5 tabular">{vehicle.current_meter_reading.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Total Expense</p>
              <p className="text-ink mt-0.5 tabular font-semibold">{totalExpense.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Cost / KM</p>
              <p className="text-ink mt-0.5 tabular">{costPerKm !== null ? costPerKm.toFixed(2) : "—"}</p>
            </div>
            <div>
              <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Fuel Expense</p>
              <p className="text-ink mt-0.5 tabular">{fuelExpense.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Opening Meter</p>
              <p className="text-ink mt-0.5 tabular">{vehicle.opening_meter_reading.toLocaleString()}</p>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-surface overflow-hidden">
            <div className="px-4 py-2.5 border-b border-line flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Expense History</h2>
              {canManage && (
                <Link href={`/expenses/new`} className="text-xs text-accent-ink underline underline-offset-2">
                  + New Expense
                </Link>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
                  <tr>
                    <th className="text-left px-3 py-2">Head</th>
                    <th className="text-left px-3 py-2">Date</th>
                    <th className="text-right px-3 py-2">Meter</th>
                    <th className="text-right px-3 py-2">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(expenses ?? []).map((e) => {
                    const head = e.expense_heads as unknown as { name: string } | null;
                    return (
                      <tr key={e.id} className="border-t border-line">
                        <td className="px-3 py-2 text-ink">
                          <Link href={`/expenses/${e.id}`} className="text-accent-ink underline underline-offset-2">
                            {head?.name}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-ink-faint text-xs">{e.expense_date}</td>
                        <td className="px-3 py-2 text-right tabular text-ink-soft">{e.odometer_reading ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular text-ink">{e.amount.toLocaleString()}</td>
                      </tr>
                    );
                  })}
                  {!expenses?.length && (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-ink-faint">
                        No expense has been recorded for this vehicle yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {canManage && (
            <div className="rounded-xl border border-line bg-surface p-4">
              <h2 className="text-sm font-semibold text-ink mb-2">Manage</h2>
              <EditVehicleForm
                vehicleId={id}
                currentAssignedUserId={vehicle.assigned_user_id}
                currentAssignmentDate={vehicle.assignment_date}
                currentStatus={vehicle.status}
                profiles={profiles ?? []}
              />
            </div>
          )}
          <div className="rounded-xl border border-line bg-surface p-4 space-y-2">
            <h2 className="text-sm font-semibold text-ink mb-1">Documents</h2>
            <AttachmentsPanel ownerTable="vehicles" ownerId={id} revalidateTo={`/setup/vehicles/${id}`} attachments={attachments ?? []} canManage={canManage} />
          </div>
        </div>
      </div>
    </div>
  );
}
