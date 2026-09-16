import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner } from "@/lib/auth";
import { HEALTH_LABEL_TEXT, HEALTH_BADGE_STYLE, type HealthLabel } from "@/lib/orderHealth";
import { resolveRange, buildTimeBuckets, RANGE_LABEL } from "@/lib/dashboardHelpers";
import { TrendLineChart, type TrendSeries } from "@/components/TrendLineChart";
import { CompareBarChart, type CompareBar } from "@/components/CompareBarChart";
import { Badge } from "@/components/ui/Badge";
import {
  HelpCircle,
  FileText,
  ShoppingCart,
  TrendingUp,
  Truck,
  CreditCard,
  Landmark,
  Wallet,
  Boxes,
  Sun,
  CloudSun,
  Moon,
} from "lucide-react";

const LINE_LABEL: Record<string, string> = { material_supply: "Material Supply", fabrication: "Fabrication" };

type SearchParams = { line?: string; range?: string; from?: string; to?: string };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Owner-exclusive by explicit request — every individual report under
  // /reports/* keeps its own, unchanged access list; only this overview
  // page itself is now Owner-only.
  if (!isOwner(user)) redirect("/");

  const { line, range, from: fromParam, to: toParam } = await searchParams;
  const selectedLine = line === "material_supply" || line === "fabrication" ? line : "combined";
  const resolved = resolveRange(range, fromParam, toParam);
  const { from, to } = resolved;
  function buildHref(overrides: Partial<{ range: string; line: string; from: string; to: string }>) {
    const merged = { range: resolved.range as string, line: selectedLine as string, from, to, ...overrides };
    const params = new URLSearchParams();
    params.set("line", merged.line);
    params.set("range", merged.range);
    if (merged.range === "custom") {
      params.set("from", merged.from);
      params.set("to", merged.to);
    }
    return `/reports?${params.toString()}`;
  }
  function pill(active: boolean) {
    return `rounded px-3 py-1 text-xs font-medium transition ${active ? "bg-accent text-white" : "text-ink-soft hover:bg-surface-2"}`;
  }

  const supabase = await createClient();

  // Every figure on this dashboard used to come from fetching whole tables —
  // every query, quotation, sales order, payment, invoice, job, PO and
  // delivery challan ever created — and reducing them in JavaScript. On the
  // owner's home screen, that grew with the business forever.
  //
  // fn_owner_dashboard returns the scalars as one row; the three short tables
  // return exactly the six rows they display; the trend chart gets per-day
  // counts instead of raw rows. What each function computes is documented in
  // its migration, and every figure was checked against the old JS result
  // before this page was switched over.
  const [
    { data: dash },
    { data: trendRows },
    { data: jobStatusList },
    { data: pendingDeliveryList },
    { data: paymentFollowupList },
    { data: recentQueries },
    { data: recentQuotations },
    { data: dailySnapshots },
  ] = await Promise.all([
    supabase.rpc("fn_owner_dashboard", { p_line: selectedLine, p_from: from, p_to: to }),
    supabase.rpc("fn_dashboard_trend", { p_line: selectedLine, p_from: from, p_to: to }),
    supabase.rpc("fn_dashboard_job_status", { p_line: selectedLine }),
    supabase.rpc("fn_dashboard_pending_delivery", { p_line: selectedLine }),
    supabase.rpc("fn_dashboard_payment_followups"),
    supabase.from("queries").select("id, query_no, status, parties(legal_name)").order("created_at", { ascending: false }).limit(6),
    supabase.from("quotations").select("id, quotation_no, status, parties(legal_name)").order("created_at", { ascending: false }).limit(6),
    supabase.from("daily_snapshots").select("*").order("snapshot_date", { ascending: false }).limit(30),
  ]);

  const d = (dash ?? {}) as Record<string, number>;
  const num = (key: string) => Number(d[key] ?? 0);

  // ---------- Flow KPIs (period-filtered) ----------
  const queriesInRangeCount = num("queries_in_range");
  const quotationsSentCount = num("quotations_sent_in_range");
  const salesOrdersInRangeCount = num("sales_orders_in_range");
  const convertedInRange = num("converted_in_range");
  const conversionPct = quotationsSentCount ? Math.round((convertedInRange / quotationsSentCount) * 100) : 0;
  const paymentsReceivedTotal = num("payments_received_total");

  // ---------- Point-in-time KPIs ----------
  const pendingDeliverCount = num("pending_deliver_count");
  const pendingInvoiceCount = num("pending_invoice_count");
  const receivablesTotal = num("receivables_total");
  const payablesTotal = num("payables_total");
  const cashBankTotal = num("cash_balance") + num("bank_total") + num("petty_total");
  const stockValueTotal = num("stock_value_total");

  // ---------- Action Required ----------
  const creditWarningCount = num("credit_warning_count");
  const quotationFollowupCount = num("quotation_followup_count");
  const shortageItemCount = num("shortage_item_count");
  const materialPendingJobCount = num("material_pending_job_count");
  const jobDelayedCount = num("job_delayed_count");
  const deliveryOverdueCount = num("delivery_overdue_count");
  const clientAcceptancePendingCount = num("client_acceptance_pending_count");
  const overdueInvoiceCount = num("overdue_invoice_count");

  // ---------- Order Health ----------
  const onTrackCount = num("on_track_count");
  const attentionCount = num("attention_count");
  const delayedCount = num("delayed_count");

  type ActionItem = { key: string; label: string; count: number; href: string };
  const actionItems: ActionItem[] = [
    { key: "credit", label: "Credit Limit Warning", count: creditWarningCount, href: "/reports/credit-limit-warning" },
    { key: "followup", label: "Quotation Follow-up Due", count: quotationFollowupCount, href: "/reports/quotation-followups" },
    ...(selectedLine === "material_supply"
      ? []
      : [{ key: "matpurchase", label: "Material Purchase Pending", count: materialPendingJobCount, href: "/jobs?status=MaterialPending" }]),
    ...(selectedLine === "material_supply" ? [] : [{ key: "shortage", label: "Raw Material Shortage", count: shortageItemCount, href: "/reports/raw-material-shortage" }]),
    ...(selectedLine === "material_supply" ? [] : [{ key: "jobdelay", label: "Job Delayed", count: jobDelayedCount, href: "/reports/order-health" }]),
    { key: "deliveryoverdue", label: "Delivery Overdue", count: deliveryOverdueCount, href: "/reports/order-health" },
    { key: "acceptance", label: "Client Acceptance Pending", count: clientAcceptancePendingCount, href: "/delivery-challans?acceptance=Pending" },
    { key: "invoicepending", label: "Invoice Pending", count: pendingInvoiceCount, href: "/reports/pending-orders" },
    { key: "paymentoverdue", label: "Payment Overdue", count: overdueInvoiceCount, href: "/reports/ar-aging" },
  ];

  // ---------- Pending From Whom ----------
  type PendingBucket = { key: string; label: string; count: number; href: string };
  const pendingFromWhom: PendingBucket[] = [
    { key: "client", label: "Client", count: num("client_pending_count"), href: "/quotations?status=Sent" },
    { key: "supplier", label: "Supplier", count: num("open_po_count"), href: "/purchase-orders?open=1" },
    ...(selectedLine === "material_supply"
      ? []
      : [{ key: "purchase", label: "Purchase", count: materialPendingJobCount, href: "/jobs?status=MaterialPending" }]),
    ...(selectedLine === "material_supply"
      ? []
      : [{ key: "fabrication", label: "Fabrication", count: num("fabrication_pending_count"), href: "/jobs?health=attention" }]),
    { key: "accounts", label: "Accounts", count: num("accounts_pending_count"), href: "/reports/ar-aging" },
  ];

  // ---------- Management Charts ----------
  // The buckets themselves are still built here (daily up to 31 days, weekly
  // beyond), but they are filled from per-day counts rather than from every
  // row's created_at.
  const buckets = buildTimeBuckets(from, to);
  const bucketLabels = buckets.map((b) => b.label);
  function sumPerBucket(pick: (r: { day: string; queries: number; quotations: number; sales_orders: number }) => number): number[] {
    return buckets.map((b) =>
      (trendRows ?? []).reduce((total, r) => (r.day >= b.start && r.day <= b.end ? total + pick(r) : total), 0)
    );
  }
  const trendSeries: TrendSeries[] = [
    { key: "queries", label: "Queries", color: "var(--ledger)", values: sumPerBucket((r) => Number(r.queries)) },
    { key: "quotations", label: "Quotations", color: "var(--accent)", values: sumPerBucket((r) => Number(r.quotations)) },
    { key: "po", label: "PO Received (Sales Order)", color: "var(--good)", values: sumPerBucket((r) => Number(r.sales_orders)) },
  ];

  const materialVsFabricationBars: CompareBar[] = [
    { key: "ms", label: "Material Supply Orders (Active)", value: num("active_material_supply_so_count"), color: "var(--ledger)" },
    { key: "fab", label: "Fabrication Jobs (In Progress)", value: num("active_fabrication_job_count"), color: "var(--accent)" },
  ];

  const receivablesVsPayablesBars: CompareBar[] = [
    { key: "ar", label: "Receivables", value: receivablesTotal, color: "var(--warn)" },
    { key: "ap", label: "Payables", value: payablesTotal, color: "var(--bad)" },
  ];

  const snapshotsAsc = [...(dailySnapshots ?? [])].reverse();
  const financialTrendSeries: TrendSeries[] = [
    { key: "cashbank", label: "Cash + Bank", color: "var(--good)", values: snapshotsAsc.map((s) => s.cash_in_hand + s.bank_balance + s.petty_cash_balance) },
    { key: "ar", label: "Receivable", color: "var(--warn)", values: snapshotsAsc.map((s) => s.total_ar_outstanding) },
    { key: "ap", label: "Payable", color: "var(--bad)", values: snapshotsAsc.map((s) => s.total_ap_outstanding) },
  ];
  const financialTrendLabels = snapshotsAsc.map((s) => s.snapshot_date.slice(5));

  // ---------- Operational sections ----------
  const jobStatusRows = jobStatusList ?? [];
  const pendingDeliveryRows = pendingDeliveryList ?? [];
  const paymentFollowupRows = paymentFollowupList ?? [];

  const latestSnapshot = dailySnapshots?.[0];

  type PartyRef = { legal_name: string } | null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Owner Dashboard</h1>
        <p className="mt-1 text-sm text-ink-soft">Live management view of the business — Sales, Fabrication, Accounts, and Owner action items all in one place.</p>
      </div>

      <GreetingBanner fullName={user.fullName} />

      <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-ink-faint font-mono">
            {resolved.label} — {from === to ? from : `${from} to ${to}`}
          </p>
          <div className="flex flex-wrap gap-2">
            <div className="flex gap-1 rounded-md border border-line bg-bg p-1">
              {(["today", "week", "month"] as const).map((r) => (
                <Link key={r} href={buildHref({ range: r })} className={pill(resolved.range === r)}>
                  {RANGE_LABEL[r]}
                </Link>
              ))}
              <Link href={buildHref({ range: "custom" })} className={pill(resolved.range === "custom")}>
                Custom
              </Link>
            </div>
            <div className="flex gap-1 rounded-md border border-line bg-bg p-1">
              {(["combined", "material_supply", "fabrication"] as const).map((l) => (
                <Link key={l} href={buildHref({ line: l })} className={pill(selectedLine === l)}>
                  {l === "combined" ? "All" : LINE_LABEL[l]}
                </Link>
              ))}
            </div>
          </div>
        </div>
        {resolved.range === "custom" && (
          <form className="flex flex-wrap items-end gap-2 pt-3 border-t border-line">
            <input type="hidden" name="range" value="custom" />
            <input type="hidden" name="line" value={selectedLine} />
            <label className="text-xs text-ink-faint">
              From
              <input type="date" name="from" defaultValue={from} className="input !py-1.5 text-sm mt-1" />
            </label>
            <label className="text-xs text-ink-faint">
              To
              <input type="date" name="to" defaultValue={to} className="input !py-1.5 text-sm mt-1" />
            </label>
            <button type="submit" className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition">
              Apply
            </button>
          </form>
        )}
        <p className="text-[11px] text-ink-faint pt-1 border-t border-line">
          Note: A Query/Quotation&apos;s business line is determined only after it becomes a Sales Order — the Material Supply/Fabrication
          filter affects Sales Order, Job, Delivery, and Receivable numbers; Queries, Quotations, Payables, Cash &amp; Bank, and Stock Value
          remain company-wide.
        </p>
      </div>

      {/* ---------- TOP KPI CARDS ---------- */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <KpiCard realHref={`/queries?from=${from}&to=${to}`} value={queriesInRangeCount.toLocaleString()} label="Queries Received" icon={<HelpCircle size={17} />} />
        <KpiCard realHref={`/quotations?from=${from}&to=${to}`} value={quotationsSentCount.toLocaleString()} label="Quotations Sent" icon={<FileText size={17} />} />
        <KpiCard realHref={`/sales-orders?from=${from}&to=${to}`} value={salesOrdersInRangeCount.toLocaleString()} label="PO Received" icon={<ShoppingCart size={17} />} />
        <KpiCard realHref={`/quotations?from=${from}&to=${to}`} value={`${conversionPct}%`} label="Quotation → PO Conversion" icon={<TrendingUp size={17} />} />
        <KpiCard
          realHref="/reports/pending-orders"
          value={pendingDeliverCount.toLocaleString()}
          label="Pending Deliveries"
          tone={pendingDeliverCount > 0 ? "warn" : undefined}
          icon={<Truck size={17} />}
        />
        <KpiCard
          realHref={`/payments?direction=receipt&from=${from}&to=${to}`}
          value={paymentsReceivedTotal.toLocaleString()}
          label="Payments Received"
          tone="good"
          icon={<CreditCard size={17} />}
        />
        <KpiCard
          realHref="/reports/ar-aging"
          value={receivablesTotal.toLocaleString()}
          label="Receivables"
          tone={receivablesTotal > 0 ? "warn" : undefined}
          icon={<Landmark size={17} />}
        />
        <KpiCard
          realHref="/reports/ap-aging"
          value={payablesTotal.toLocaleString()}
          label="Payables"
          tone={payablesTotal > 0 ? "warn" : undefined}
          icon={<Landmark size={17} />}
        />
        <KpiCard realHref="/cash-bank" value={cashBankTotal.toLocaleString()} label="Cash &amp; Bank" tone="good" icon={<Wallet size={17} />} />
        <KpiCard realHref="/inventory" value={stockValueTotal.toLocaleString()} label="Raw Material Stock Value" icon={<Boxes size={17} />} />
      </div>

      {/* ---------- MANAGEMENT CHARTS ---------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartCard title="Queries vs Quotations vs PO Trend">
          <TrendLineChart labels={bucketLabels} series={trendSeries} />
        </ChartCard>
        <ChartCard title="Material Supply Orders vs Fabrication Jobs in Progress">
          {selectedLine === "combined" ? (
            <CompareBarChart bars={materialVsFabricationBars} />
          ) : (
            <p className="text-xs text-ink-faint">This comparison is only shown in the &quot;All&quot; view.</p>
          )}
        </ChartCard>
        <ChartCard title="Receivables vs Payables">
          <CompareBarChart bars={receivablesVsPayablesBars} />
        </ChartCard>
        <ChartCard title="Cash &amp; Bank / Financial Trend (Daily Snapshot)">
          <TrendLineChart labels={financialTrendLabels} series={financialTrendSeries} />
        </ChartCard>
      </div>

      {/* ---------- OPERATIONAL SECTIONS ---------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SectionCard title="Recent Queries" seeAllHref="/queries">
          <div className="divide-y divide-line">
            {(recentQueries ?? []).map((q) => (
              <Link key={q.id} href={`/queries/${q.id}`} className="flex items-center justify-between px-4 py-2 text-sm even:bg-bg hover:bg-surface-2 transition">
                <span className="text-ink-soft text-xs">
                  <span className="font-mono text-ink">{q.query_no}</span> — {(q.parties as unknown as PartyRef)?.legal_name ?? "—"}
                </span>
                <span className="text-ink-faint text-xs whitespace-nowrap">{q.status}</span>
              </Link>
            ))}
            {!recentQueries?.length && <p className="px-4 py-4 text-center text-xs text-ink-faint">No queries found.</p>}
          </div>
        </SectionCard>

        <SectionCard title="Recent Quotations" seeAllHref="/quotations">
          <div className="divide-y divide-line">
            {(recentQuotations ?? []).map((q) => (
              <Link key={q.id} href={`/quotations/${q.id}`} className="flex items-center justify-between px-4 py-2 text-sm even:bg-bg hover:bg-surface-2 transition">
                <span className="text-ink-soft text-xs">
                  <span className="font-mono text-ink">{q.quotation_no}</span> — {(q.parties as unknown as PartyRef)?.legal_name ?? "—"}
                </span>
                <span className="text-ink-faint text-xs whitespace-nowrap">{q.status}</span>
              </Link>
            ))}
            {!recentQuotations?.length && <p className="px-4 py-4 text-center text-xs text-ink-faint">No quotations found.</p>}
          </div>
        </SectionCard>

        {selectedLine !== "material_supply" && (
          <SectionCard title="Fabrication Jobs Status" seeAllHref="/jobs">
            <div className="divide-y divide-line">
              {jobStatusRows.map((j) => {
                return (
                  <Link key={j.id} href={`/jobs/${j.id}`} className="flex items-center justify-between px-4 py-2 text-sm even:bg-bg hover:bg-surface-2 transition">
                    <span className="text-ink-soft text-xs">
                      <span className="font-mono text-ink">{j.job_no}</span> — {j.client} ({j.progress_pct}%)
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${HEALTH_BADGE_STYLE[j.health_label as HealthLabel]}`}>
                      {HEALTH_LABEL_TEXT[j.health_label as HealthLabel]}
                    </span>
                  </Link>
                );
              })}
              {!jobStatusRows.length && <p className="px-4 py-4 text-center text-xs text-ink-faint">No active Jobs found.</p>}
            </div>
          </SectionCard>
        )}

        <SectionCard title="Pending Deliveries" seeAllHref="/reports/pending-orders">
          <div className="divide-y divide-line">
            {pendingDeliveryRows.map((l, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-2 text-sm even:bg-bg">
                <span className="text-ink-soft text-xs">
                  <span className="font-mono text-ink">{l.so_no}</span> — {l.client}
                </span>
                <span className={`text-xs tabular ${l.days > 30 ? "text-bad font-medium" : "text-warn"}`}>{l.days} days</span>
              </div>
            ))}
            {!pendingDeliveryRows.length && <p className="px-4 py-4 text-center text-xs text-ink-faint">No pending deliveries found.</p>}
          </div>
        </SectionCard>

        <SectionCard title="Payment Follow-ups" seeAllHref="/reports/ar-aging">
          <div className="divide-y divide-line">
            {paymentFollowupRows.map((r) => (
              <Link key={r.invoice_id} href={`/clients/${r.party_id}`} className="flex items-center justify-between px-4 py-2 text-sm even:bg-bg hover:bg-surface-2 transition">
                <span className="text-ink-soft text-xs">{r.client}</span>
                <span className="text-xs tabular text-bad font-medium">
                  {r.amount.toLocaleString()} ({r.overdue_days}d)
                </span>
              </Link>
            ))}
            {!paymentFollowupRows.length && <p className="px-4 py-4 text-center text-xs text-ink-faint">No overdue payments found.</p>}
          </div>
        </SectionCard>
      </div>

      {/* ---------- OWNER CONTROL SECTIONS ---------- */}
      <SectionCard title="Action Required">
        <div className="divide-y divide-line">
          {actionItems.map((item, i) => (
            <Link
              key={item.key}
              href={item.href}
              className={`flex items-center justify-between px-4 py-2.5 text-sm hover:bg-surface-2 transition ${i % 2 === 1 ? "bg-bg" : ""}`}
            >
              <span className={item.count > 0 ? "text-ink" : "text-ink-faint"}>{item.label}</span>
              <Badge tone={item.count > 0 ? "bad" : "neutral"} dot={false}>
                {item.count}
              </Badge>
            </Link>
          ))}
        </div>
      </SectionCard>

      <div className="rounded-xl border border-line bg-surface p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-ink">Order Health</h2>
          <Link href="/reports/order-health" className="text-xs text-accent-ink underline underline-offset-2">
            Stage Aging Detail →
          </Link>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="On Track" value={onTrackCount} tone="good" href="/reports/order-health" />
          <StatTile label="Attention Required" value={attentionCount} tone="warn" href="/reports/order-health" />
          <StatTile label="Delayed" value={delayedCount} tone="bad" href="/reports/order-health" />
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface p-5">
        <h2 className="text-sm font-semibold text-ink mb-3">Pending From Whom?</h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {pendingFromWhom.map((b) => (
            <StatTile key={b.key} label={b.label} value={b.count} tone={b.count > 0 ? "warn" : undefined} href={b.href} />
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-ink">Daily Owner Summary {latestSnapshot ? `— ${latestSnapshot.snapshot_date}` : ""}</h2>
          <Link href="/reports/daily-snapshot" className="text-xs text-accent-ink underline underline-offset-2">
            Full History →
          </Link>
        </div>
        {latestSnapshot ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <SummaryStat label="Sales" value={latestSnapshot.sales_today} tone="good" />
            <SummaryStat label="Collections" value={latestSnapshot.collections_today} tone="good" />
            <SummaryStat label="Payments" value={latestSnapshot.payments_today} tone="bad" />
            <SummaryStat label="Expenses" value={latestSnapshot.expenses_today} tone="bad" />
          </div>
        ) : (
          <p className="text-sm text-ink-faint">No Daily Snapshot generated yet — the first snapshot will be generated automatically tonight at 00:10.</p>
        )}
      </div>

      {/* ---------- REPORT DIRECTORY ---------- */}
      <div>
        <h2 className="text-sm font-semibold text-ink mb-3">All Reports</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ReportLink href="/reports/daily-ledger" title="Daily Ledger / Day Book" desc="All journal entries for any given day, with debit/credit." />
          <ReportLink href="/reports/ar-aging" title="AR Aging" desc="Client-wise outstanding, aging buckets (Current, 1-30, 31-60, 61-90, 90+)." />
          <ReportLink href="/reports/ap-aging" title="AP Aging" desc="Supplier-wise outstanding, aging buckets." />
          <ReportLink href="/reports/trial-balance" title="Trial Balance" desc="Har account ka debit/credit total — poore ledger ka summary." />
          <ReportLink href="/reports/profit-loss" title="Profit &amp; Loss Statement" desc="Revenue, COGS, Gross Profit, Operating Expenses, Net Profit — date range ke sath." />
          <ReportLink href="/reports/balance-sheet" title="Balance Sheet" desc="Assets = Liabilities + Equity, live snapshot." />
          <ReportLink href="/reports/cash-flow" title="Cash Flow &amp; Position" desc="Cash in Hand + Bank + Petty Cash — opening/receipts/payments/closing, combined Cash/Bank Book." />
          <ReportLink href="/reports/party-ledger" title="Customer / Supplier Ledger" desc="The complete running-balance ledger for any client or supplier." />
          <ReportLink href="/reports/general-ledger" title="General Ledger" desc="The complete running-balance ledger for any account." />
          <ReportLink href="/reports/vehicle-expenses" title="Vehicle &amp; Rider Expenses" desc="Vehicle-wise fuel/maintenance/cost-per-KM, aur Engineer/Rider-wise field expense totals." />
          <ReportLink href="/reports/pending-orders" title="Pending Order &amp; Delivery Report" desc="Every SO line with pending delivery/invoicing, oldest orders first." />
          <ReportLink href="/reports/purchase-pending" title="Purchase Pending Report" desc="Every PO line with pending receiving, most overdue first." />
          <ReportLink href="/reports/grn-report" title="GRN / Receiving Report" desc="GRNs for the date range, with short/excess." />
          <ReportLink href="/reports/payment-collection" title="Payment Collection Report" desc="Collections for the date range, by method and top clients." />
          <ReportLink href="/reports/customer-business" title="Customer-wise Business Report" desc="Order value, invoiced amount, and outstanding for each client — all in one place." />
          <ReportLink href="/reports/order-status" title="Order-wise Status" desc="The complete journey of a Sales Order — from Query to Payment." />
          <ReportLink href="/reports/order-health" title="Order Health &amp; Stage Aging" desc="Health flag (On Track/At Risk/Delayed/Stalled) and days in current stage for every open SO/PO/Job." />
          <ReportLink href="/reports/daily-snapshot" title="Daily Snapshot" desc="Daily Cash/Bank/Stock/AR/AP position — generated automatically at night, and can also be generated manually." />
          <ReportLink href="/reports/credit-limit-warning" title="Credit Limit Warning" desc="Clients whose outstanding has reached 90% or more of their Credit Limit." />
          <ReportLink href="/reports/quotation-followups" title="Quotation Follow-up Due" desc="Sent quotations whose linked Query follow-up date has arrived or passed." />
          <ReportLink href="/reports/raw-material-shortage" title="Raw Material Shortage" desc="Items whose shortage has left Job(s) stuck at Material Pending." />
        </div>
      </div>
    </div>
  );
}

const TONE_CHIP: Record<"good" | "warn" | "bad" | "neutral", string> = {
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  neutral: "bg-accent-soft text-accent-ink",
};

function KpiCard({
  realHref,
  value,
  label,
  tone,
  icon,
}: {
  realHref: string;
  value: string;
  label: string;
  tone?: "good" | "warn" | "bad";
  icon?: React.ReactNode;
}) {
  const toneClass = tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "good" ? "text-good" : "text-ink";
  return (
    <Link href={realHref} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4 hover:bg-surface-2 transition">
      {icon && <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${TONE_CHIP[tone ?? "neutral"]}`}>{icon}</span>}
      <span className="min-w-0">
        <p className={`text-lg font-semibold tabular truncate ${toneClass}`}>{value}</p>
        <p className="mt-0.5 text-[11px] text-ink-faint uppercase tracking-wide font-mono truncate">{label}</p>
      </span>
    </Link>
  );
}

function GreetingBanner({ fullName }: { fullName: string }) {
  const karachiHour = Number(new Date().toLocaleString("en-US", { timeZone: "Asia/Karachi", hour: "2-digit", hour12: false }));
  const { greeting, Icon } = karachiHour < 12 ? { greeting: "Good Morning", Icon: Sun } : karachiHour < 17 ? { greeting: "Good Afternoon", Icon: CloudSun } : { greeting: "Good Evening", Icon: Moon };
  const firstName = fullName.split(" ")[0] || fullName;

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl px-6 py-4 text-white"
      style={{ background: "linear-gradient(90deg, #2b3a55, #3a4d6e)" }}
    >
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10">
          <Icon size={18} />
        </span>
        <div>
          <p className="text-sm font-semibold">
            {greeting}, {firstName}!
          </p>
          <p className="text-xs text-white/70">Today&apos;s business overview is ready.</p>
        </div>
      </div>
      <p className="max-w-xs text-right text-xs italic text-white/70">&quot;Consistent numbers create stronger tomorrows.&quot;</p>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <h2 className="text-sm font-semibold text-ink mb-3">{title}</h2>
      {children}
    </div>
  );
}

function SectionCard({ title, seeAllHref, children }: { title: string; seeAllHref?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      <div className="px-4 py-2.5 border-b border-line flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {seeAllHref && (
          <Link href={seeAllHref} className="text-xs text-accent-ink underline underline-offset-2">
            View all →
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

function StatTile({ label, value, tone, href }: { label: string; value: number; tone?: "good" | "warn" | "bad"; href: string }) {
  const toneClass = tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "good" ? "text-good" : "text-ink";
  return (
    <Link href={href} className="rounded-lg border border-line bg-bg p-3 text-center hover:bg-surface-2 transition block">
      <p className={`text-xl font-semibold tabular ${toneClass}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-ink-faint uppercase tracking-wide font-mono">{label}</p>
    </Link>
  );
}

function SummaryStat({ label, value, tone }: { label: string; value: number; tone: "good" | "bad" }) {
  return (
    <div>
      <p className={`text-lg font-semibold tabular ${tone === "good" ? "text-good" : "text-bad"}`}>{value.toLocaleString()}</p>
      <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">{label}</p>
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
