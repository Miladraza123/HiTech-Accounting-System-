import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { ItemForm } from "@/components/ItemForm";
import { ItemToggle } from "@/components/ItemToggle";

const TAX_LABEL: Record<string, string> = {
  standard: "Standard",
  reduced: "Reduced",
  zero_rated: "Zero-rated",
  exempt: "Exempt",
};

export default async function ItemsPage() {
  const user = await getCurrentUser();
  const canManage = isOwner(user) || hasRole(user, "store") || hasRole(user, "production");

  const supabase = await createClient();
  const [{ data: items }, { data: units }] = await Promise.all([
    supabase.from("items").select("*").order("item_code"),
    supabase.from("units").select("*").order("code"),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Item Master</h1>
        <p className="mt-1 text-sm text-ink-soft">Raw material, stocked goods, and fabrication products are all selected from this list.</p>
      </div>

      {canManage && <ItemForm units={units ?? []} />}

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-4 py-2.5">Code</th>
                <th className="text-left px-4 py-2.5">Description</th>
                <th className="text-left px-4 py-2.5">Category</th>
                <th className="text-left px-4 py-2.5">Unit</th>
                <th className="text-left px-4 py-2.5">Tax</th>
                <th className="text-left px-4 py-2.5">Stocked?</th>
                <th className="text-left px-4 py-2.5">Status</th>
                {canManage && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {(items ?? []).map((it) => (
                <tr key={it.id} className="border-t border-line">
                  <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">
                    <Link href={`/items/${it.id}`} className="text-accent-ink underline underline-offset-2">
                      {it.item_code}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-ink whitespace-nowrap">
                    {it.description}
                    {it.spec && <span className="block text-xs text-ink-faint">{it.spec}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-ink-soft">{it.category ?? "—"}</td>
                  <td className="px-4 py-2.5 text-ink-soft font-mono text-xs">{it.base_unit}</td>
                  <td className="px-4 py-2.5 text-ink-soft text-xs">{TAX_LABEL[it.tax_category]}</td>
                  <td className="px-4 py-2.5 text-xs">{it.is_stocked ? "Yes" : "No"}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-mono ${it.is_active ? "bg-good-soft text-good" : "bg-surface-2 text-ink-faint"}`}
                    >
                      {it.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  {canManage && (
                    <td className="px-4 py-2.5 text-right">
                      <ItemToggle id={it.id} isActive={it.is_active} />
                    </td>
                  )}
                </tr>
              ))}
              {!items?.length && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-ink-faint">
                    No items created yet.
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
