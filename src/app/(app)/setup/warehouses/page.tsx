import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { WarehouseForm } from "@/components/WarehouseForm";
import { ToggleWarehouseButton } from "@/components/ToggleWarehouseButton";

export default async function WarehousesPage() {
  const user = await getCurrentUser();
  const canManage = isOwner(user) || hasRole(user, "store");
  if (!canManage) redirect("/");

  const supabase = await createClient();
  const { data: warehouses } = await supabase.from("warehouses").select("*").order("created_at");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Warehouses</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Ek company, multiple warehouses/branches — har jaga ka stock alag track hoga (Phase 3 mein).
        </p>
      </div>

      <WarehouseForm />

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
            <tr>
              <th className="text-left px-4 py-2.5">Code</th>
              <th className="text-left px-4 py-2.5">Name</th>
              <th className="text-left px-4 py-2.5">Address</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {(warehouses ?? []).map((w) => (
              <tr key={w.id} className="border-t border-line">
                <td className="px-4 py-2.5 font-mono text-ink-soft">{w.code}</td>
                <td className="px-4 py-2.5 text-ink">{w.name}</td>
                <td className="px-4 py-2.5 text-ink-soft">{w.address ?? "—"}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-mono ${
                      w.is_active ? "bg-good-soft text-good" : "bg-surface-2 text-ink-faint"
                    }`}
                  >
                    {w.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <ToggleWarehouseButton id={w.id} isActive={w.is_active} />
                </td>
              </tr>
            ))}
            {!warehouses?.length && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-faint">
                  Koi warehouse nahi bana abhi tak.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
