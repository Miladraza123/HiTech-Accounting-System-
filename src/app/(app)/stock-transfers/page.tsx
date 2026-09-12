import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { buttonClass } from "@/components/ui/Button";

const STATUS_STYLE: Record<string, string> = {
  Posted: "bg-good-soft text-good",
  Cancelled: "bg-bad-soft text-bad",
};

export default async function StockTransfersPage() {
  const user = await getCurrentUser();
  const canCreate = await hasPermission(user, "stock_transfer.create");

  const supabase = await createClient();
  const { data: transfers } = await supabase
    .from("stock_transfers")
    .select("*, from:warehouses!stock_transfers_from_warehouse_id_fkey(name), to:warehouses!stock_transfers_to_warehouse_id_fkey(name)")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink">Stock Transfers</h1>
          <p className="mt-1 text-sm text-ink-soft">Moving stock from one warehouse to another — no impact on the GL (both are the same company&apos;s asset).</p>
        </div>
        {canCreate && (
          <Link href="/stock-transfers/new" className={buttonClass()}>
            + New Stock Transfer
          </Link>
        )}
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-4 py-2.5">Transfer #</th>
                <th className="text-left px-4 py-2.5">From</th>
                <th className="text-left px-4 py-2.5">To</th>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {(transfers ?? []).map((t) => {
                const from = t.from as unknown as { name: string } | null;
                const to = t.to as unknown as { name: string } | null;
                return (
                  <tr key={t.id} className="border-t border-line hover:bg-surface-2">
                    <td className="px-4 py-2.5">
                      <Link href={`/stock-transfers/${t.id}`} className="text-accent-ink underline underline-offset-2 font-mono text-xs">
                        {t.transfer_no}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft">{from?.name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-ink-soft">{to?.name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-ink-faint text-xs">{t.transfer_date}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[t.status] ?? ""}`}>{t.status}</span>
                    </td>
                  </tr>
                );
              })}
              {!transfers?.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-ink-faint">
                    No Stock Transfer has been created yet.
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
