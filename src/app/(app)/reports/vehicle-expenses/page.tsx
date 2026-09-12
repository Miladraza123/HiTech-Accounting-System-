import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";

export default async function VehicleExpensesReportPage() {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "accounts") || hasRole(user, "auditor"))) redirect("/");

  const supabase = await createClient();
  const [{ data: vehicleSummary }, { data: personSummary }] = await Promise.all([
    supabase.from("vehicle_expense_summary").select("*").order("total_expense", { ascending: false }),
    supabase.from("responsible_person_expense_summary").select("*").gt("expense_count", 0).order("total_expense", { ascending: false }),
  ]);

  const highestVehicle = (vehicleSummary ?? [])[0];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/reports" className="text-xs text-ink-faint hover:text-ink">
          ← Reports
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">Vehicle &amp; Engineer/Rider Expense Report</h1>
        <p className="text-sm text-ink-soft">Vehicle-wise / Fuel / Maintenance / Cost-per-KM, and person-wise field expense totals.</p>
      </div>

      {highestVehicle && (highestVehicle.total_expense ?? 0) > 0 && (
        <div className="rounded-md border border-warn bg-warn-soft px-4 py-2.5 text-sm text-warn">
          Highest Expense Vehicle: <strong>{highestVehicle.vehicle_no}</strong> — {highestVehicle.total_expense?.toLocaleString()}
        </div>
      )}

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="px-4 py-2.5 border-b border-line">
          <h2 className="text-sm font-semibold text-ink">Vehicle-wise Expense</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-3 py-2">Vehicle</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-right px-3 py-2">Distance (KM)</th>
                <th className="text-right px-3 py-2">Fuel</th>
                <th className="text-right px-3 py-2">Maintenance</th>
                <th className="text-right px-3 py-2">Total</th>
                <th className="text-right px-3 py-2">Cost/KM</th>
              </tr>
            </thead>
            <tbody>
              {(vehicleSummary ?? []).map((v) => {
                const distance = (v.current_meter_reading ?? 0) - (v.opening_meter_reading ?? 0);
                const costPerKm = distance > 0 ? (v.total_expense ?? 0) / distance : null;
                return (
                  <tr key={v.vehicle_id} className="border-t border-line">
                    <td className="px-3 py-2">
                      <Link href={`/setup/vehicles/${v.vehicle_id}`} className="text-accent-ink underline underline-offset-2 font-mono text-xs">
                        {v.vehicle_no}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-ink-faint text-xs">{v.status}</td>
                    <td className="px-3 py-2 text-right tabular text-ink-soft">{distance.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular text-ink-soft">{(v.fuel_expense ?? 0).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular text-ink-soft">{(v.maintenance_expense ?? 0).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular text-ink font-medium">{(v.total_expense ?? 0).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular text-ink-soft">{costPerKm !== null ? costPerKm.toFixed(2) : "—"}</td>
                  </tr>
                );
              })}
              {!vehicleSummary?.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-ink-faint">
                    No vehicles created yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="px-4 py-2.5 border-b border-line">
          <h2 className="text-sm font-semibold text-ink">Engineer / Rider-wise Expense</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-3 py-2">Person</th>
                <th className="text-right px-3 py-2"># Expenses</th>
                <th className="text-right px-3 py-2">Pending Settlement</th>
                <th className="text-right px-3 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {(personSummary ?? []).map((p) => (
                <tr key={p.user_id} className="border-t border-line">
                  <td className="px-3 py-2 text-ink">{p.full_name}</td>
                  <td className="px-3 py-2 text-right tabular text-ink-soft">{p.expense_count}</td>
                  <td className="px-3 py-2 text-right tabular">
                    {(p.pending_settlement_count ?? 0) > 0 ? (
                      <span className="text-warn font-medium">{p.pending_settlement_count}</span>
                    ) : (
                      <span className="text-ink-faint">0</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular text-ink font-medium">{(p.total_expense ?? 0).toLocaleString()}</td>
                </tr>
              ))}
              {!personSummary?.length && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-ink-faint">
                    No person-linked expenses yet.
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
