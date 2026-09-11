import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";

const STATUS_STYLE: Record<string, string> = {
  Posted: "bg-good-soft text-good",
  Cancelled: "bg-bad-soft text-bad",
};

const DIRECTION_LABEL: Record<string, string> = { receipt: "Receipt (in)", payment: "Payment (out)" };

export default async function PaymentsPage() {
  const user = await getCurrentUser();
  const canCreate = isOwner(user) || hasRole(user, "accounts");

  const supabase = await createClient();
  const { data: payments } = await supabase.from("payments").select("*, parties(legal_name)").order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink">Payments</h1>
          <p className="mt-1 text-sm text-ink-soft">Bill-wise Payment &amp; Recovery — client receipts aur supplier payments.</p>
        </div>
        {canCreate && (
          <Link href="/payments/new" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition">
            + Naya Payment
          </Link>
        )}
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-4 py-2.5">Payment #</th>
                <th className="text-left px-4 py-2.5">Party</th>
                <th className="text-left px-4 py-2.5">Direction</th>
                <th className="text-right px-4 py-2.5">Amount</th>
                <th className="text-right px-4 py-2.5">Unallocated</th>
                <th className="text-left px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {(payments ?? []).map((p) => {
                const party = p.parties as unknown as { legal_name: string } | null;
                return (
                  <tr key={p.id} className="border-t border-line hover:bg-surface-2">
                    <td className="px-4 py-2.5">
                      <Link href={`/payments/${p.id}`} className="text-accent-ink underline underline-offset-2 font-mono text-xs">
                        {p.payment_no}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft text-xs whitespace-nowrap">{party?.legal_name}</td>
                    <td className="px-4 py-2.5 text-ink-soft text-xs">{DIRECTION_LABEL[p.direction]}</td>
                    <td className="px-4 py-2.5 text-right tabular text-ink">{p.amount.toLocaleString()}</td>
                    <td className={`px-4 py-2.5 text-right tabular ${p.unallocated_amount > 0 ? "text-warn font-medium" : "text-ink-soft"}`}>
                      {p.unallocated_amount.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${STATUS_STYLE[p.status] ?? ""}`}>{p.status}</span>
                    </td>
                  </tr>
                );
              })}
              {!payments?.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-ink-faint">
                    Koi Payment nahi hai abhi tak.
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
