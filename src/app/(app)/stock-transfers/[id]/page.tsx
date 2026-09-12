import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { CancelStockTransferButton } from "@/components/CancelStockTransferButton";

const STATUS_STYLE: Record<string, string> = {
  Posted: "bg-good-soft text-good",
  Cancelled: "bg-bad-soft text-bad",
};

export default async function StockTransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const canManage = await hasPermission(user, "stock_transfer.create");

  const supabase = await createClient();
  const [{ data: transfer }, { data: lines }] = await Promise.all([
    supabase
      .from("stock_transfers")
      .select("*, from:warehouses!stock_transfers_from_warehouse_id_fkey(name), to:warehouses!stock_transfers_to_warehouse_id_fkey(name)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("stock_transfer_lines").select("*, items(item_code, description)").eq("transfer_id", id).order("sort_order"),
  ]);

  if (!transfer) notFound();

  const from = transfer.from as unknown as { name: string } | null;
  const to = transfer.to as unknown as { name: string } | null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href="/stock-transfers" className="text-xs text-ink-faint hover:text-ink">
            ← Stock Transfers
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-lg font-semibold text-ink font-mono">{transfer.transfer_no}</h1>
            <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[transfer.status] ?? ""}`}>{transfer.status}</span>
          </div>
          <p className="text-sm text-ink-soft mt-0.5">
            {from?.name} → {to?.name}
          </p>
        </div>
      </div>

      {transfer.status === "Cancelled" && transfer.cancel_reason && (
        <div className="rounded-md bg-bad-soft border border-bad px-4 py-2 text-sm text-bad">Cancel wajah: {transfer.cancel_reason}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl border border-line bg-surface p-4 grid grid-cols-2 gap-4 text-sm">
            <Field label="Transfer Date" value={transfer.transfer_date} />
            {transfer.remarks && <Field label="Remarks" value={transfer.remarks} />}
          </div>

          <div className="rounded-xl border border-line bg-surface overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
                  <tr>
                    <th className="text-left px-3 py-2">Item</th>
                    <th className="text-right px-3 py-2">Qty</th>
                    <th className="text-right px-3 py-2">Rate (avg cost)</th>
                  </tr>
                </thead>
                <tbody>
                  {(lines ?? []).map((l) => {
                    const item = l.items as unknown as { item_code: string; description: string } | null;
                    return (
                      <tr key={l.id} className="border-t border-line">
                        <td className="px-3 py-2 text-ink">{item ? `${item.item_code} — ${item.description}` : "—"}</td>
                        <td className="px-3 py-2 text-right tabular text-ink-soft">{l.qty}</td>
                        <td className="px-3 py-2 text-right tabular text-ink-soft">{l.rate}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {canManage && transfer.status === "Posted" && (
            <div className="rounded-xl border border-line bg-surface p-4">
              <h2 className="text-sm font-semibold text-ink mb-2">Actions</h2>
              <CancelStockTransferButton transferId={id} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-ink-faint">{label}</p>
      <p className="text-ink">{value}</p>
    </div>
  );
}
