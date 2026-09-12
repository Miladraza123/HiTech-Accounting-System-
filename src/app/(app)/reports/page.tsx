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
  const today = new Date().toISOString().slice(0, 10);
  const [
    { data: salesOrders },
    { data: invoices },
    { data: outstandingRows },
    { data: jobs },
    { data: tb },
    { count: queryCount },
    { count: quotationCount },
    { count: openTaskCount },
    { count: overdueTaskCount },
  ] = await Promise.all([
    supabase.from("sales_orders").select("id, business_line, status, grand_total").not("status", "in", "(Cancelled)"),
    supabase.from("invoices").select("id, sales_order_id, grand_total, status"),
    supabase.from("invoice_outstanding").select("invoice_id, outstanding_amount"),
    supabase.from("jobs").select("id, sales_order_id, status"),
    supabase.from("trial_balance").select("*"),
    supabase.from("queries").select("id", { count: "exact", head: true }),
    supabase.from("quotations").select("id", { count: "exact", head: true }),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("status", "Open"),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("status", "Open").lt("due_date", today),
  ]);

  // Quotation Conversion % — how many Quotations actually turned into a
  // Sales Order (every Sales Order has quotation_id set, so a distinct count
  // of that column tells us how many Quotations converted).
  const { data: soQuotationIds } = await supabase.from("sales_orders").select("quotation_id").not("status", "eq", "Cancelled");
  const convertedQuotations = new Set((soQuotationIds ?? []).map((s) => s.quotation_id)).size;
  const conversionPct = quotationCount ? Math.round((convertedQuotations / quotationCount) * 100) : 0;

  // Company Capital = Equity accounts + accumulated Retained Earnings (books
  // are never period-closed, so retained earnings = all-time net profit).
  // Working Capital here approximates Total Assets - Total Liabilities, since
  // the chart of accounts doesn't yet distinguish current vs non-current —
  // every asset/liability account today effectively IS current.
  const totalAssets = (tb ?? []).filter((r) => r.account_type === "asset").reduce((s, r) => s + (r.balance ?? 0), 0);
  const totalLiabilities = (tb ?? []).filter((r) => r.account_type === "liability").reduce((s, r) => s - (r.balance ?? 0), 0);
  const totalEquityAccounts = (tb ?? []).filter((r) => r.account_type === "equity").reduce((s, r) => s - (r.balance ?? 0), 0);
  const retainedEarnings =
    (tb ?? []).filter((r) => r.account_type === "income").reduce((s, r) => s - (r.balance ?? 0), 0) -
    (tb ?? []).filter((r) => r.account_type === "expense").reduce((s, r) => s + (r.balance ?? 0), 0);
  const companyCapital = totalEquityAccounts + retainedEarnings;
  const workingCapital = totalAssets - totalLiabilities;

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
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-4 border-t border-line">
          <div>
            <p className="text-2xl font-semibold text-ink tabular">{queryCount ?? 0}</p>
            <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Queries Received</p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-ink tabular">{quotationCount ?? 0}</p>
            <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Quotations Sent</p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-ink tabular">{conversionPct}%</p>
            <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Quotation → SO Conversion</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink mb-3">Financial Position</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-2xl font-semibold text-ink tabular">{companyCapital.toLocaleString()}</p>
            <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Company Capital / Equity</p>
          </div>
          <div>
            <p className={`text-2xl font-semibold tabular ${workingCapital >= 0 ? "text-ink" : "text-bad"}`}>{workingCapital.toLocaleString()}</p>
            <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Working Capital (approx.)</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-ink">Action Required</h2>
          <Link href="/reports/order-health" className="text-xs text-accent-ink underline underline-offset-2">
            Order Health &amp; Stage Aging →
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-2xl font-semibold text-ink tabular">{openTaskCount ?? 0}</p>
            <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Open Tasks (All Users)</p>
          </div>
          <div>
            <p className={`text-2xl font-semibold tabular ${(overdueTaskCount ?? 0) > 0 ? "text-bad" : "text-ink"}`}>{overdueTaskCount ?? 0}</p>
            <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">Overdue Tasks</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ReportLink href="/reports/daily-ledger" title="Daily Ledger / Day Book" desc="Kisi bhi din ki saari journal entries, debit/credit ke sath." />
        <ReportLink href="/reports/ar-aging" title="AR Aging" desc="Client-wise outstanding, aging buckets (Current, 1-30, 31-60, 61-90, 90+)." />
        <ReportLink href="/reports/ap-aging" title="AP Aging" desc="Supplier-wise outstanding, aging buckets." />
        <ReportLink href="/reports/trial-balance" title="Trial Balance" desc="Har account ka debit/credit total — poore ledger ka summary." />
        <ReportLink href="/reports/profit-loss" title="Profit &amp; Loss Statement" desc="Revenue, COGS, Gross Profit, Operating Expenses, Net Profit — date range ke sath." />
        <ReportLink href="/reports/balance-sheet" title="Balance Sheet" desc="Assets = Liabilities + Equity, live snapshot." />
        <ReportLink href="/reports/cash-flow" title="Cash Flow &amp; Position" desc="Cash in Hand + Bank + Petty Cash — opening/receipts/payments/closing, combined Cash/Bank Book." />
        <ReportLink href="/reports/party-ledger" title="Customer / Supplier Ledger" desc="Kisi bhi client/supplier ki poori running-balance ledger." />
        <ReportLink href="/reports/general-ledger" title="General Ledger" desc="Kisi bhi account ki poori running-balance ledger." />
        <ReportLink href="/reports/vehicle-expenses" title="Vehicle &amp; Rider Expenses" desc="Vehicle-wise fuel/maintenance/cost-per-KM, aur Engineer/Rider-wise field expense totals." />
        <ReportLink href="/reports/pending-orders" title="Pending Order &amp; Delivery Report" desc="Har SO line jahan delivery/invoicing baki hai, purane order pehle." />
        <ReportLink href="/reports/purchase-pending" title="Purchase Pending Report" desc="Har PO line jahan receiving baki hai, overdue pehle." />
        <ReportLink href="/reports/grn-report" title="GRN / Receiving Report" desc="Date range ke GRNs, short/excess ke sath." />
        <ReportLink href="/reports/payment-collection" title="Payment Collection Report" desc="Date range ki collection, method-wise aur top clients." />
        <ReportLink href="/reports/customer-business" title="Customer-wise Business Report" desc="Har client ka order value, invoiced, outstanding — ek jaga." />
        <ReportLink href="/reports/order-status" title="Order-wise Status" desc="Ek Sales Order ka poora safar — Query se Payment tak." />
        <ReportLink href="/reports/order-health" title="Order Health &amp; Stage Aging" desc="Har open SO/PO/Job ka health flag (On Track/At Risk/Delayed/Stalled) aur current stage mein kitne din se hai." />
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
