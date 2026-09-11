import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";

const LINE_LABEL: Record<string, string> = { material_supply: "Material Supply", fabrication: "Fabrication", combined: "Combined" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ line?: string }> }) {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "accounts") || hasRole(user, "auditor"))) redirect("/");

  const { line } = await searchParams;
  const selectedLine = line === "material_supply" || line === "fabrication" ? line : "combined";

  const supabase = await createClient();
  const [{ data: salesOrders }, { data: invoices }, { data: outstandingRows }, { data: jobs }] = await Promise.all([
    supabase.from("sales_orders").select("id, business_line, status, grand_total").not("status", "in", "(Cancelled)"),
    supabase.from("invoices").select("id, sales_order_id, grand_total, status"),
    supabase.from("invoice_outstanding").select("invoice_id, outstanding_amount"),
    supabase.from("jobs").select("id, sales_order_id, status"),
  ]);

  const soById = new Map((salesOrders ?? []).map((s) => [s.id, s]));
  const invoiceSoById = new Map((invoices ?? []).map((i) => [i.id, i.sales_order_id]));

  function matchesLine(businessLine: string | undefined) {
    return selectedLine === "combined" || businessLine === selectedLine;
  }

  const activeSoCount = (salesOrders ?? []).filter((s) => matchesLine(s.business_line) && !["Delivered", "Invoiced", "Closed"].includes(s.status)).length;
  const soGrandTotal = (salesOrders ?? []).filter((s) => matchesLine(s.business_line)).reduce((sum, s) => sum + s.grand_total, 0);

  const invoicedTotal = (invoices ?? [])
    .filter((i) => i.status === "Posted" && matchesLine(soById.get(i.sales_order_id)?.business_line))
    .reduce((sum, i) => sum + i.grand_total, 0);

  const outstandingTotal = (outstandingRows ?? [])
    .filter((o) => matchesLine(soById.get(invoiceSoById.get(o.invoice_id!) ?? "")?.business_line))
    .reduce((sum, o) => sum + (o.outstanding_amount ?? 0), 0);

  const activeJobCount = (jobs ?? []).filter(
    (j) => !["Delivered", "Cancelled"].includes(j.status) && (selectedLine === "combined" || selectedLine === "fabrication")
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Reports</h1>
        <p className="mt-1 text-sm text-ink-soft">Owner Dashboard aur standard accounting/sales reports.</p>
      </div>

      <div className="rounded-xl border border-line bg-surface p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-sm font-semibold text-ink">Owner Dashboard — Sales Overview</h2>
          <div className="flex gap-1 rounded-md border border-line bg-bg p-1">
            {(["combined", "material_supply", "fabrication"] as const).map((l) => (
              <Link
                key={l}
                href={`/reports?line=${l}`}
                className={`rounded px-3 py-1 text-xs font-medium transition ${
                  selectedLine === l ? "bg-accent text-white" : "text-ink-soft hover:bg-surface-2"
                }`}
              >
                {LINE_LABEL[l]}
              </Link>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-2xl font-semibold text-ink tabular">{activeSoCount}</p>
            <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Active Sales Orders</p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-ink tabular">{soGrandTotal.toLocaleString()}</p>
            <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Sales Order Value</p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-ink tabular">{invoicedTotal.toLocaleString()}</p>
            <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Invoiced</p>
          </div>
          <div>
            <p className={`text-2xl font-semibold tabular ${outstandingTotal > 0 ? "text-warn" : "text-ink"}`}>{outstandingTotal.toLocaleString()}</p>
            <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Outstanding Receivable</p>
          </div>
          {(selectedLine === "combined" || selectedLine === "fabrication") && (
            <div>
              <p className="text-2xl font-semibold text-ink tabular">{activeJobCount}</p>
              <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Active Jobs</p>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ReportLink href="/reports/daily-ledger" title="Daily Ledger / Day Book" desc="Kisi bhi din ki saari journal entries, debit/credit ke sath." />
        <ReportLink href="/reports/ar-aging" title="AR Aging" desc="Client-wise outstanding, aging buckets (Current, 1-30, 31-60, 61-90, 90+)." />
        <ReportLink href="/reports/ap-aging" title="AP Aging" desc="Supplier-wise outstanding, aging buckets." />
        <ReportLink href="/reports/trial-balance" title="Trial Balance" desc="Har account ka debit/credit total — poore ledger ka summary." />
      </div>
    </div>
  );
}

function ReportLink({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link href={href} className="rounded-xl border border-line bg-surface p-4 hover:bg-surface-2 transition block">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-1 text-xs text-ink-soft">{desc}</p>
    </Link>
  );
}
