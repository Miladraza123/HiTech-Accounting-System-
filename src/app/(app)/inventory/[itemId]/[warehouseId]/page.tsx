import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const TXN_STYLE: Record<string, string> = {
  GRN: "bg-good-soft text-good",
  Issue: "bg-warn-soft text-warn",
  Return: "bg-ledger-soft text-ledger",
  DC: "bg-warn-soft text-warn",
  Adjustment: "bg-accent-soft text-accent-ink",
  OpeningStock: "bg-surface-2 text-ink-faint",
};

export default async function StockLedgerPage({
  params,
}: {
  params: Promise<{ itemId: string; warehouseId: string }>;
}) {
  const { itemId, warehouseId } = await params;
  const supabase = await createClient();

  const [{ data: item }, { data: warehouse }, { data: entries }, { data: profiles }] = await Promise.all([
    supabase.from("items").select("*").eq("id", itemId).maybeSingle(),
    supabase.from("warehouses").select("*").eq("id", warehouseId).maybeSingle(),
    supabase
      .from("stock_ledger")
      .select("*")
      .eq("item_id", itemId)
      .eq("warehouse_id", warehouseId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }),
    supabase.from("profiles").select("id, full_name"),
  ]);

  if (!item || !warehouse) notFound();

  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/inventory" className="text-xs text-ink-faint hover:text-ink">
          ← Inventory
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">
          {item.item_code} — {item.description}
        </h1>
        <p className="text-sm text-ink-soft">{warehouse.name}</p>
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-4 py-2.5">Type</th>
                <th className="text-right px-4 py-2.5">Qty</th>
                <th className="text-right px-4 py-2.5">Rate</th>
                <th className="text-right px-4 py-2.5">Balance</th>
                <th className="text-right px-4 py-2.5">Avg Cost</th>
                <th className="text-left px-4 py-2.5">By</th>
              </tr>
            </thead>
            <tbody>
              {(entries ?? []).map((e) => (
                <tr key={e.id} className="border-t border-line">
                  <td className="px-4 py-2.5 text-ink-soft whitespace-nowrap">{new Date(e.created_at).toLocaleString("en-PK")}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${TXN_STYLE[e.txn_type] ?? ""}`}>{e.txn_type}</span>
                  </td>
                  <td className={`px-4 py-2.5 text-right tabular ${e.qty < 0 ? "text-bad" : "text-good"}`}>{e.qty > 0 ? `+${e.qty}` : e.qty}</td>
                  <td className="px-4 py-2.5 text-right tabular text-ink-soft">{e.rate}</td>
                  <td className="px-4 py-2.5 text-right tabular text-ink font-medium">{e.running_balance}</td>
                  <td className="px-4 py-2.5 text-right tabular text-ink-soft">{e.avg_cost}</td>
                  <td className="px-4 py-2.5 text-ink-soft text-xs">{(e.created_by && nameById.get(e.created_by)) || "—"}</td>
                </tr>
              ))}
              {!entries?.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-ink-faint">
                    Koi movement nahi hai.
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
