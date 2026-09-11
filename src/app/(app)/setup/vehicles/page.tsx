import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { NewVehicleForm } from "@/components/NewVehicleForm";

const STATUS_STYLE: Record<string, string> = {
  Active: "bg-good-soft text-good",
  UnderMaintenance: "bg-warn-soft text-warn",
  Retired: "bg-surface-2 text-ink-faint",
  Unassigned: "bg-surface-2 text-ink-faint",
};

export default async function VehiclesPage() {
  const user = await getCurrentUser();
  const canManage = isOwner(user) || hasRole(user, "accounts");
  if (!canManage) redirect("/");

  const supabase = await createClient();
  const [{ data: vehicles }, { data: profiles }] = await Promise.all([
    supabase.from("vehicles").select("*, profiles(full_name)").order("vehicle_no"),
    supabase.from("profiles").select("*").eq("is_active", true).order("full_name"),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Vehicles / Fleet</h1>
        <p className="mt-1 text-sm text-ink-soft">Engineers/Riders ko diye gaye vehicles — fuel/maintenance expenses in se link hote hain.</p>
      </div>

      <NewVehicleForm profiles={profiles ?? []} />

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-4 py-2.5">Vehicle #</th>
                <th className="text-left px-4 py-2.5">Type / Make</th>
                <th className="text-left px-4 py-2.5">Assigned To</th>
                <th className="text-right px-4 py-2.5">Meter Reading</th>
                <th className="text-left px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {(vehicles ?? []).map((v) => {
                const assignee = v.profiles as unknown as { full_name: string } | null;
                return (
                  <tr key={v.id} className="border-t border-line hover:bg-surface-2">
                    <td className="px-4 py-2.5">
                      <Link href={`/setup/vehicles/${v.id}`} className="text-accent-ink underline underline-offset-2 font-mono text-xs">
                        {v.vehicle_no}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft text-xs">
                      {v.vehicle_type ?? "—"} {v.make_model && `— ${v.make_model}`}
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft">{assignee?.full_name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular text-ink">{v.current_meter_reading.toLocaleString()}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[v.status] ?? ""}`}>{v.status}</span>
                    </td>
                  </tr>
                );
              })}
              {!vehicles?.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-ink-faint">
                    Koi vehicle nahi bana abhi tak.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
