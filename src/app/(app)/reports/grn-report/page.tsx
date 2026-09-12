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

export default async function GrnReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "store") || hasRole(user, "accounts") || hasRole(user, "auditor"))) redirect("/");

  const { from, to } = await searchParams;
  const defaults = defaultMonthRange();
  const fromDate = from || defaults.from;
  const toDate = to || defaults.to;

  const supabase = await createClient();
  const { data: grns } = await supabase
    .from("grns")
    .select("*, parties(legal_name), purchase_orders(po_no), warehouses(name), grn_lines(short_excess_qty, this_receipt_qty)")
    .gte("received_date", fromDate)
    .lte("received_date", toDate)
    .order("received_date", { ascending: false });

  type Line = { short_excess_qty: number; this_receipt_qty: number };
  const rows = (grns ?? []).map((g) => {
    const lines = g.grn_lines as unknown as Line[];
    const totalReceived = lines.reduce((s, l) => s + l.this_receipt_qty, 0);
    const totalShortExcess = lines.reduce((s, l) => s + l.short_excess_qty, 0);
    return {
      grn_no: g.grn_no,
      supplier: (g.parties as unknown as { legal_name: string } | null)?.legal_name ?? "—",
      po_no: (g.purchase_orders as unknown as { po_no: string } | null)?.po_no ?? "—",
      warehouse: (g.warehouses as unknown as { name: string } | null)?.name ?? "—",
      received_date: g.received_date,
      totalReceived,
      totalShortExcess,
    };
  });

  const totalGrns = rows.length;
  const totalShort = rows.filter((r) => r.totalShortExcess < 0).length;
  const totalExcess = rows.filter((r) => r.totalShortExcess > 0).length;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/reports" className="text-xs text-ink-faint hover:text-ink">
          ← Reports
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">GRN / Receiving Report</h1>
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
        <Link href="/reports/grn-report" className="text-xs text-ink-faint underline underline-offset-2">
          This Month
        </Link>
      </form>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-2xl font-semibold text-ink tabular">{totalGrns}</p>
          <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Total GRNs</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-2xl font-semibold text-bad tabular">{totalShort}</p>
          <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">GRNs with Shortage</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-2xl font-semibold text-warn tabular">{totalExcess}</p>
          <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">GRNs with Excess</p>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="text-left px-3 py-2">GRN #</th>
                <th className="text-left px-3 py-2">Supplier</th>
                <th className="text-left px-3 py-2">PO #</th>
                <th className="text-left px-3 py-2">Warehouse</th>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-right px-3 py-2">Received</th>
                <th className="text-right px-3 py-2">Short/Excess</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="px-3 py-2 font-mono text-xs text-ink">{r.grn_no}</td>
                  <td className="px-3 py-2 text-ink-soft">{r.supplier}</td>
                  <td className="px-3 py-2 font-mono text-xs text-ink-soft">{r.po_no}</td>
                  <td className="px-3 py-2 text-ink-soft">{r.warehouse}</td>
                  <td className="px-3 py-2 text-ink-faint text-xs">{r.received_date}</td>
                  <td className="px-3 py-2 text-right tabular text-ink">{r.totalReceived.toFixed(3)}</td>
                  <td className="px-3 py-2 text-right tabular">
                    {r.totalShortExcess !== 0 ? (
                      <span className={r.totalShortExcess < 0 ? "text-bad font-medium" : "text-warn font-medium"}>
                        {r.totalShortExcess > 0 ? "+" : ""}
                        {r.totalShortExcess.toFixed(3)}
                      </span>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-ink-faint">
                    No GRNs found for this period.
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
