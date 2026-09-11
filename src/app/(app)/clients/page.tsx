import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { PartyForm } from "@/components/PartyForm";
import { PartyToggle } from "@/components/PartyToggle";

const TYPE_LABEL: Record<string, string> = { client: "Client", supplier: "Supplier", both: "Client + Supplier" };

export default async function ClientsPage() {
  const user = await getCurrentUser();
  const canManage = isOwner(user) || hasRole(user, "sales") || hasRole(user, "store");

  const supabase = await createClient();
  const [{ data: parties }, { data: provinces }] = await Promise.all([
    supabase.from("parties").select("*").order("created_at", { ascending: false }),
    supabase.from("provinces").select("*").order("name"),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Clients &amp; Suppliers</h1>
        <p className="mt-1 text-sm text-ink-soft">Query aur Purchase dono isi party list se client/supplier select karte hain.</p>
      </div>

      {canManage && <PartyForm provinces={provinces ?? []} />}

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-4 py-2.5">Naam</th>
                <th className="text-left px-4 py-2.5">Type</th>
                <th className="text-left px-4 py-2.5">NTN / STRN</th>
                <th className="text-left px-4 py-2.5">Province</th>
                <th className="text-right px-4 py-2.5">Credit Limit</th>
                <th className="text-left px-4 py-2.5">Status</th>
                {canManage && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {(parties ?? []).map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="px-4 py-2.5 text-ink whitespace-nowrap">{p.legal_name}</td>
                  <td className="px-4 py-2.5 text-ink-soft whitespace-nowrap">{TYPE_LABEL[p.party_type] ?? p.party_type}</td>
                  <td className="px-4 py-2.5 text-ink-soft font-mono text-xs whitespace-nowrap">
                    {[p.ntn, p.strn].filter(Boolean).join(" / ") || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-ink-soft">{p.province ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular text-ink-soft whitespace-nowrap">
                    {p.credit_limit ? p.credit_limit.toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-mono ${p.is_active ? "bg-good-soft text-good" : "bg-surface-2 text-ink-faint"}`}
                    >
                      {p.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  {canManage && (
                    <td className="px-4 py-2.5 text-right">
                      <PartyToggle id={p.id} isActive={p.is_active} />
                    </td>
                  )}
                </tr>
              ))}
              {!parties?.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-ink-faint">
                    Koi client/supplier nahi mila.
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
