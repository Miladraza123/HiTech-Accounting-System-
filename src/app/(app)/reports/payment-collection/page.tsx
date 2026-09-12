import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";

function defaultMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { from, to };
}

export default async function PaymentCollectionReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "accounts") || hasRole(user, "auditor"))) redirect("/");

  const { from, to } = await searchParams;
  const defaults = defaultMonthRange();
  const fromDate = from || defaults.from;
  const toDate = to || defaults.to;

  const supabase = await createClient();
  const { data: payments } = await supabase
    .from("payments")
    .select("*, parties(legal_name)")
    .gte("payment_date", fromDate)
    .lte("payment_date", toDate)
    .eq("status", "Posted")
    .order("payment_date", { ascending: false });

  const receipts = (payments ?? []).filter((p) => p.direction === "receipt");
  const disbursements = (payments ?? []).filter((p) => p.direction === "payment");
  const totalReceipts = receipts.reduce((s, p) => s + p.amount, 0);
  const totalDisbursements = disbursements.reduce((s, p) => s + p.amount, 0);

  const byMethod = new Map<string, number>();
  for (const p of receipts) {
    const key = p.method || "—";
    byMethod.set(key, (byMethod.get(key) ?? 0) + p.amount);
  }

  const byClient = new Map<string, number>();
  for (const p of receipts) {
    const name = (p.parties as unknown as { legal_name: string } | null)?.legal_name ?? "—";
    byClient.set(name, (byClient.get(name) ?? 0) + p.amount);
  }
  const topClients = [...byClient.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href="/reports" className="text-xs text-ink-faint hover:text-ink">
            ← Reports
          </Link>
          <h1 className="text-lg font-semibold text-ink mt-1">Payment Collection Report</h1>
        </div>
        <a
          href={`/reports/payment-collection/export?from=${fromDate}&to=${toDate}`}
          className="rounded-md border border-line-strong bg-bg px-3 py-2 text-xs text-ink hover:bg-surface-2 transition whitespace-nowrap"
        >
          Export to Excel
        </a>
      </div>

      <form className="flex items-center gap-2 flex-wrap">
        <label className="flex items-center gap-1.5 text-xs text-ink-soft">
          From
          <input type="date" name="from" defaultValue={fromDate} className="input !py-1.5 text-xs" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-ink-soft">
          To
          <input type="date" name="to" defaultValue={toDate} className="input !py-1.5 text-xs" />
        </label>
        <button type="submit" className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition">
          Apply
        </button>
        <Link href="/reports/payment-collection" className="text-xs text-ink-faint underline underline-offset-2">
          This Month
        </Link>
      </form>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-2xl font-semibold text-good tabular">{totalReceipts.toLocaleString()}</p>
          <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Total Collected (Receipts)</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-2xl font-semibold text-bad tabular">{totalDisbursements.toLocaleString()}</p>
          <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Total Disbursed (Payments)</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-2xl font-semibold text-ink tabular">{(totalReceipts - totalDisbursements).toLocaleString()}</p>
          <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Net</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="px-4 py-2.5 border-b border-line">
            <h2 className="text-sm font-semibold text-ink">Collection by Method</h2>
          </div>
          <ul className="divide-y divide-line">
            {[...byMethod.entries()].map(([method, amt]) => (
              <li key={method} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="text-ink-soft">{method}</span>
                <span className="tabular text-ink font-medium">{amt.toLocaleString()}</span>
              </li>
            ))}
            {!byMethod.size && <li className="px-4 py-6 text-center text-ink-faint text-sm">No receipts for this period.</li>}
          </ul>
        </div>

        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="px-4 py-2.5 border-b border-line">
            <h2 className="text-sm font-semibold text-ink">Top Clients (by Collection)</h2>
          </div>
          <ul className="divide-y divide-line">
            {topClients.map(([name, amt]) => (
              <li key={name} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="text-ink-soft">{name}</span>
                <span className="tabular text-ink font-medium">{amt.toLocaleString()}</span>
              </li>
            ))}
            {!topClients.length && <li className="px-4 py-6 text-center text-ink-faint text-sm">No receipts for this period.</li>}
          </ul>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="px-4 py-2.5 border-b border-line">
          <h2 className="text-sm font-semibold text-ink">All Transactions</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-3 py-2">Payment #</th>
                <th className="text-left px-3 py-2">Party</th>
                <th className="text-left px-3 py-2">Direction</th>
                <th className="text-left px-3 py-2">Method</th>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-right px-3 py-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(payments ?? []).map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="px-3 py-2 font-mono text-xs text-ink">
                    <Link href={`/payments/${p.id}`} className="text-accent-ink underline underline-offset-2">
                      {p.payment_no}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-ink-soft">{(p.parties as unknown as { legal_name: string } | null)?.legal_name ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    <span className={p.direction === "receipt" ? "text-good" : "text-bad"}>{p.direction === "receipt" ? "Receipt" : "Payment"}</span>
                  </td>
                  <td className="px-3 py-2 text-ink-soft text-xs">{p.method ?? "—"}</td>
                  <td className="px-3 py-2 text-ink-faint text-xs">{p.payment_date}</td>
                  <td className="px-3 py-2 text-right tabular text-ink">{p.amount.toLocaleString()}</td>
                </tr>
              ))}
              {!payments?.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-ink-faint">
                    No payments for this period.
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
