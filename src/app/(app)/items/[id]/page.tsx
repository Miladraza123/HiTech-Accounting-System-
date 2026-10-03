import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { ItemAltUnitsPanel } from "@/components/ItemAltUnitsPanel";
import { ItemToggle } from "@/components/ItemToggle";
import { ItemReorderLevelField } from "@/components/ItemReorderLevelField";
import { EditItemForm } from "@/components/EditItemForm";

const TAX_LABEL: Record<string, string> = {
  standard: "Standard",
  reduced: "Reduced",
  zero_rated: "Zero-rated",
  exempt: "Exempt",
};

export default async function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const canManage = isOwner(user) || hasRole(user, "store") || hasRole(user, "production");

  const supabase = await createClient();
  const [{ data: item }, { data: units }, { data: altUnits }, { data: purchaseHistory }] = await Promise.all([
    supabase.from("items").select("*").eq("id", id).maybeSingle(),
    supabase.from("units").select("*").order("code"),
    supabase.from("item_alt_units").select("*").eq("item_id", id).order("unit"),
    supabase.rpc("fn_item_purchase_history", { p_item_id: id, p_limit: 20 }),
  ]);

  if (!item) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/items" className="text-xs text-ink-faint hover:text-ink">
          ← Item Master
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold text-ink font-mono">{item.item_code}</h1>
          <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${item.is_active ? "bg-good-soft text-good" : "bg-surface-2 text-ink-faint"}`}>
            {item.is_active ? "Active" : "Inactive"}
          </span>
        </div>
        <p className="text-sm text-ink-soft mt-0.5">
          {item.description}
          {item.spec && <span className="block text-xs text-ink-faint">{item.spec}</span>}
        </p>
      </div>

      {canManage && (
        <EditItemForm
          itemId={item.id}
          item={{
            item_code: item.item_code,
            description: item.description,
            category: item.category,
            spec: item.spec,
            base_unit: item.base_unit,
            hs_code: item.hs_code,
            tax_category: item.tax_category,
            is_stocked: item.is_stocked,
            standard_cost: item.standard_cost,
          }}
          units={units ?? []}
        />
      )}

      <div className="rounded-xl border border-line bg-surface p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div>
          <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Base Unit</p>
          <p className="text-ink mt-0.5 font-mono">{item.base_unit}</p>
        </div>
        <div>
          <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Category</p>
          <p className="text-ink mt-0.5">{item.category ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Tax</p>
          <p className="text-ink mt-0.5">{TAX_LABEL[item.tax_category]}</p>
        </div>
        <div>
          <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Stocked?</p>
          <p className="text-ink mt-0.5">{item.is_stocked ? "Haan" : "Nahi"}</p>
        </div>
        {item.hs_code && (
          <div>
            <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">HS Code</p>
            <p className="text-ink mt-0.5 font-mono">{item.hs_code}</p>
          </div>
        )}
        <div>
          <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Standard Cost</p>
          <p className="text-ink mt-0.5 tabular">{item.standard_cost}</p>
        </div>
        {canManage ? (
          <ItemReorderLevelField itemId={item.id} reorderLevel={item.reorder_level} />
        ) : (
          <div>
            <p className="text-xs text-ink-faint uppercase tracking-wide font-mono">Reorder Level</p>
            <p className="text-ink mt-0.5 tabular">{item.reorder_level ?? "—"}</p>
          </div>
        )}
      </div>

      {canManage && (
        <div className="rounded-xl border border-line bg-surface p-4 flex items-center justify-between">
          <span className="text-sm text-ink-soft">Item Status</span>
          <ItemToggle id={item.id} isActive={item.is_active} />
        </div>
      )}

      <ItemAltUnitsPanel itemId={item.id} baseUnit={item.base_unit} units={units ?? []} altUnits={altUnits ?? []} canManage={canManage} canDelete={isOwner(user)} />

      {!!purchaseHistory?.length && (
        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="px-4 py-2.5 border-b border-line">
            <h2 className="text-sm font-semibold text-ink">Purchase History</h2>
            <p className="text-xs text-ink-faint mt-0.5">Every supplier and rate this item has been bought at — most recent first.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="text-left px-3 py-2">PO #</th>
                  <th className="text-left px-3 py-2">Date</th>
                  <th className="text-left px-3 py-2">Supplier</th>
                  <th className="text-right px-3 py-2">Rate</th>
                </tr>
              </thead>
              <tbody>
                {purchaseHistory.map((h) => (
                  <tr key={h.po_id} className="border-t border-line">
                    <td className="px-3 py-2">
                      <Link href={`/purchase-orders/${h.po_id}`} className="font-mono text-xs text-accent-ink underline underline-offset-2">
                        {h.po_no}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-ink-soft text-xs">{h.po_date}</td>
                    <td className="px-3 py-2 text-ink">{h.supplier_name}</td>
                    <td className="px-3 py-2 text-right tabular text-ink">{h.rate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
