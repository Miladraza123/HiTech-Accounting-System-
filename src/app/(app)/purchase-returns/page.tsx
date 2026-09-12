import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";

const STATUS_STYLE: Record<string, string> = {
  Posted: "bg-good-soft text-good",
  Cancelled: "bg-bad-soft text-bad",
};

export default async function PurchaseReturnsPage() {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "accounts") || hasRole(user, "store") || hasRole(user, "auditor"))) redirect("/");

  const supabase = await createClient();
  const { data: returns } = await supabase
    .from("purchase_returns")
    .select("*, parties(legal_name), supplier_bills(bill_no)")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Purchase Returns</h1>
        <p className="mt-1 text-sm text-ink-soft">Debit notes for goods returned to suppliers — created from a Posted Supplier Bill.</p>
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-4 py-2.5">Return #</th>
                <th className="text-left px-4 py-2.5">Bill</th>
                <th className="text-left px-4 py-2.5">Supplier</th>
                <th className="text-left px-4 py-2.5">Return Date</th>
                <th className="text-right px-4 py-2.5">Amount</th>
                <th className="text-left px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {(returns ?? []).map((r) => {
                const bill = r.supplier_bills as unknown as { bill_no: string } | null;
                const party = r.parties as unknown as { legal_name: string } | null;
                return (
                  <tr key={r.id} className="border-t border-line hover:bg-surface-2">
                    <td className="px-4 py-2.5">
                      <Link href={`/purchase-returns/${r.id}`} className="text-accent-ink underline underline-offset-2 font-mono text-xs">
                        {r.return_no}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <Link href={`/supplier-bills/${r.supplier_bill_id}`} className="text-accent-ink underline underline-offset-2 font-mono text-xs">
                        {bill?.bill_no}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-ink whitespace-nowrap">{party?.legal_name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-ink-faint text-xs">{r.return_date}</td>
                    <td className="px-4 py-2.5 text-right tabular text-ink">{r.grand_total.toLocaleString()}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[r.status] ?? ""}`}>{r.status}</span>
                    </td>
                  </tr>
                );
              })}
              {!returns?.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-ink-faint">
                    No Purchase Returns yet.
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
