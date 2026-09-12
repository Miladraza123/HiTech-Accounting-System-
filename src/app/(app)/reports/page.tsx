import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isOwner, hasRole } from "@/lib/auth";
import { computeHealth, daysSince, HEALTH_LABEL_TEXT, HEALTH_BADGE_STYLE, type HealthLabel } from "@/lib/orderHealth";
import { agingBucket, dueDateFrom } from "@/lib/aging";
import { resolveRange, toExclusiveUpperBound, buildTimeBuckets, countInBuckets, RANGE_LABEL } from "@/lib/dashboardHelpers";
import { TrendLineChart, type TrendSeries } from "@/components/TrendLineChart";
import { CompareBarChart, type CompareBar } from "@/components/CompareBarChart";

const LINE_LABEL: Record<string, string> = { material_supply: "Material Supply", fabrication: "Fabrication" };

type SearchParams = { line?: string; range?: string; from?: string; to?: string };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await getCurrentUser();
  if (!(isOwner(user) || hasRole(user, "accounts") || hasRole(user, "auditor"))) redirect("/");

  const { line, range, from: fromParam, to: toParam } = await searchParams;
  const selectedLine = line === "material_supply" || line === "fabrication" ? line : "combined";
  const resolved = resolveRange(range, fromParam, toParam);
  const { from, to } = resolved;
  const toExclusive = toExclusiveUpperBound(to);
  const today = new Date().toISOString().slice(0, 10);

  function matchesLine(businessLine: string | null | undefined) {
    return selectedLine === "combined" || businessLine === selectedLine;
  }
  function inRange(dateStr: string) {
    return dateStr >= from && dateStr < toExclusive;
  }
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

  const [
    { data: queriesAll },
    { data: quotationsAll },
    { data: salesOrdersAll },
    { data: soLinesAll },
    { data: paymentsAll },
    { data: invoiceOutstandingRows },
    { data: invoicesAll },
    { data: partiesAll },
    { data: arSummary },
    { data: supplierBillOutstandingRows },
    { data: cashRow },
    { data: bankBalances },
    { data: pettyBalances },
    { data: currentStock },
    { data: purchaseOrdersAll },
    { data: jobsAll },
    { data: deliveryChallansAll },
    { data: jobMaterialReqShort },
    { data: dailySnapshots },
  ] = await Promise.all([
    supabase.from("queries").select("id, query_no, query_date, status, created_at, parties(legal_name)").order("created_at", { ascending: false }),
    supabase
      .from("quotations")
      .select("id, quotation_no, status, created_at, party_id, parties(legal_name), queries(next_followup_at)")
      .order("created_at", { ascending: false }),
    supabase
      .from("sales_orders")
      .select("id, so_no, business_line, status, grand_total, delivery_schedule, updated_at, created_at, quotation_id, party_id, parties(legal_name)")
      .order("created_at", { ascending: false }),
    supabase
      .from("sales_order_lines")
      .select("id, ordered_qty, delivered_qty, invoiced_qty, item_id, sales_orders!inner(so_no, business_line, status, po_date, parties(legal_name))")
      .not("sales_orders.status", "in", "(Cancelled,Closed)"),
    supabase.from("payments").select("id, direction, amount, status, created_at"),
    supabase.from("invoice_outstanding").select("invoice_id, party_id, outstanding_amount").gt("outstanding_amount", 0),
    supabase.from("invoices").select("id, invoice_date, party_id, sales_order_id"),
    supabase.from("parties").select("id, legal_name, credit_limit, credit_days, party_type"),
    supabase.from("party_ar_summary").select("*"),
    supabase.from("supplier_bill_outstanding").select("outstanding_amount"),
    supabase.from("cash_in_hand_balance").select("*").maybeSingle(),
    supabase.from("bank_account_balances").select("balance").eq("is_active", true),
    supabase.from("petty_cash_fund_balances").select("balance").eq("is_active", true),
    supabase.from("current_stock").select("stock_value"),
    supabase.from("purchase_orders").select("id, po_no, status, expected_delivery, updated_at"),
    supabase
      .from("jobs")
      .select("id, job_no, status, required_delivery_date, updated_at, progress_pct, sales_orders(so_no, parties(legal_name))")
      .order("updated_at", { ascending: false }),
    supabase.from("delivery_challans").select("id, status, acceptance_status"),
    supabase
      .from("job_material_requirements")
      .select("item_id, required_qty, reserved_qty, issued_qty, source, jobs!inner(status)")
      .eq("source", "stock")
      .eq("jobs.status", "MaterialPending"),
    supabase.from("daily_snapshots").select("*").order("snapshot_date", { ascending: false }).limit(30),
  ]);

  // ---------- Shared lookups ----------
  type PartyRef = { legal_name: string } | null;
  const soById = new Map((salesOrdersAll ?? []).map((s) => [s.id, s]));

  // ---------- Flow KPIs (period-filtered) ----------
  const queriesInRangeCount = (queriesAll ?? []).filter((q) => inRange(q.created_at)).length;
  const quotationsSentInRange = (quotationsAll ?? []).filter((q) => q.status !== "Draft" && inRange(q.created_at));
  const salesOrdersInRange = (salesOrdersAll ?? []).filter((s) => matchesLine(s.business_line) && inRange(s.created_at));
  const quotationIdsInRange = new Set(quotationsSentInRange.map((q) => q.id));
  const convertedInRange = (salesOrdersAll ?? []).filter((s) => s.status !== "Cancelled" && quotationIdsInRange.has(s.quotation_id)).length;
  const conversionPct = quotationsSentInRange.length ? Math.round((convertedInRange / quotationsSentInRange.length) * 100) : 0;
  const paymentsReceivedTotal = (paymentsAll ?? [])
    .filter((p) => p.direction === "receipt" && p.status === "Posted" && inRange(p.created_at))
    .reduce((sum, p) => sum + p.amount, 0);

  // ---------- Point-in-time KPIs ----------
  const pendingLines = (soLinesAll ?? []).map((l) => {
    const so = l.sales_orders as unknown as { so_no: string; business_line: string; status: string; po_date: string; parties: PartyRef };
    return {
      so_no: so.so_no,
      business_line: so.business_line,
      client: so.parties?.legal_name ?? "—",
      po_date: so.po_date,
      pendingDeliver: l.ordered_qty - l.delivered_qty,
      pendingInvoice: l.delivered_qty - l.invoiced_qty,
    };
  });
  const pendingDeliverLines = pendingLines.filter((l) => matchesLine(l.business_line) && l.pendingDeliver > 0.001);
  const pendingInvoiceLines = pendingLines.filter((l) => matchesLine(l.business_line) && l.pendingInvoice > 0.001);

  const invoiceById = new Map((invoicesAll ?? []).map((i) => [i.id, i]));
  const partyById = new Map((partiesAll ?? []).map((p) => [p.id, p]));
  const receivablesTotal = (invoiceOutstandingRows ?? [])
    .filter((o) => matchesLine(soById.get(invoiceById.get(o.invoice_id!)?.sales_order_id ?? "")?.business_line))
    .reduce((sum, o) => sum + (o.outstanding_amount ?? 0), 0);
  const payablesTotal = (supplierBillOutstandingRows ?? []).reduce((sum, r) => sum + (r.outstanding_amount ?? 0), 0);

  const cashBalance = cashRow?.balance ?? 0;
  const bankTotal = (bankBalances ?? []).reduce((s, b) => s + (b.balance ?? 0), 0);
  const pettyTotal = (pettyBalances ?? []).reduce((s, p) => s + (p.balance ?? 0), 0);
  const cashBankTotal = cashBalance + bankTotal + pettyTotal;
  const stockValueTotal = (currentStock ?? []).reduce((s, r) => s + (r.stock_value ?? 0), 0);

  // ---------- Overdue AR (Payment Overdue action item + Payment Follow-ups table + Accounts bucket) ----------
  const overdueInvoiceRows = (invoiceOutstandingRows ?? [])
    .map((o) => {
      const inv = invoiceById.get(o.invoice_id!);
      const party = inv ? partyById.get(inv.party_id) : null;
      if (!inv || !party) return null;
      const dueDate = dueDateFrom(inv.invoice_date, party.credit_days ?? 0);
      const bucket = agingBucket(dueDate);
      return { invoiceId: o.invoice_id!, partyId: party.id, client: party.legal_name, amount: o.outstanding_amount ?? 0, dueDate, overdueDays: daysSince(dueDate), bucket };
    })
    .filter((r): r is NonNullable<typeof r> => !!r && r.bucket !== "current")
    .sort((a, b) => b.overdueDays - a.overdueDays);

  // ---------- Credit Limit Warning ----------
  const outstandingByParty = new Map((arSummary ?? []).map((s) => [s.party_id, s.total_outstanding ?? 0]));
  const creditWarningCount = (partiesAll ?? []).filter((p) => {
    if (!["client", "both"].includes(p.party_type) || p.credit_limit <= 0) return false;
    const outstanding = outstandingByParty.get(p.id) ?? 0;
    return outstanding / p.credit_limit >= 0.9;
  }).length;

  // ---------- Quotation Follow-up Due ----------
  const quotationFollowupCount = (quotationsAll ?? []).filter((q) => {
    if (q.status !== "Sent") return false;
    const qInfo = q.queries as unknown as { next_followup_at: string | null } | null;
    return !!qInfo?.next_followup_at && qInfo.next_followup_at <= today;
  }).length;

  // ---------- Raw Material Shortage ----------
  const shortageItemIds = new Set<string>();
  for (const r of jobMaterialReqShort ?? []) {
    if (r.required_qty - r.reserved_qty - r.issued_qty > 0.001) shortageItemIds.add(r.item_id);
  }

  // ---------- Order Health (On Track / Attention Required / Delayed) ----------
  const soForHealth = (salesOrdersAll ?? []).filter((s) => matchesLine(s.business_line) && !["Delivered", "Invoiced", "Closed", "Cancelled"].includes(s.status));
  const jobForHealth = selectedLine === "material_supply" ? [] : (jobsAll ?? []).filter((j) => !["Delivered", "Cancelled"].includes(j.status));
  const poForHealth = (purchaseOrdersAll ?? []).filter((p) => !["Received", "Closed", "Cancelled"].includes(p.status));
  const healthLabels: HealthLabel[] = [
    ...soForHealth.map((s) => computeHealth({ isOpen: true, promisedDate: s.delivery_schedule, updatedAt: s.updated_at })?.label ?? "OnTrack"),
    ...jobForHealth.map((j) => computeHealth({ isOpen: true, promisedDate: j.required_delivery_date, updatedAt: j.updated_at })?.label ?? "OnTrack"),
    ...poForHealth.map((p) => computeHealth({ isOpen: true, promisedDate: p.expected_delivery, updatedAt: p.updated_at })?.label ?? "OnTrack"),
  ];
  const onTrackCount = healthLabels.filter((l) => l === "OnTrack").length;
  const attentionCount = healthLabels.filter((l) => l === "AtRisk" || l === "Stalled").length;
  const delayedCount = healthLabels.filter((l) => l === "Delayed").length;

  const jobDelayedCount = jobForHealth.filter(
    (j) => computeHealth({ isOpen: true, promisedDate: j.required_delivery_date, updatedAt: j.updated_at })?.label === "Delayed"
  ).length;
  const deliveryOverdueCount = soForHealth.filter(
    (s) => computeHealth({ isOpen: true, promisedDate: s.delivery_schedule, updatedAt: s.updated_at })?.label === "Delayed"
  ).length;
  const materialPendingJobCount = selectedLine === "material_supply" ? 0 : (jobsAll ?? []).filter((j) => j.status === "MaterialPending").length;
  const clientAcceptancePendingCount = (deliveryChallansAll ?? []).filter((d) => d.status === "Issued" && d.acceptance_status === "Pending").length;

  // ---------- Action Required ----------
  type ActionItem = { key: string; label: string; count: number; href: string };
  const actionItems: ActionItem[] = [
    { key: "credit", label: "Credit Limit Warning", count: creditWarningCount, href: "/reports/credit-limit-warning" },
    { key: "followup", label: "Quotation Follow-up Due", count: quotationFollowupCount, href: "/reports/quotation-followups" },
    ...(selectedLine === "material_supply"
      ? []
      : [{ key: "matpurchase", label: "Material Purchase Pending", count: materialPendingJobCount, href: "/jobs?status=MaterialPending" }]),
    ...(selectedLine === "material_supply" ? [] : [{ key: "shortage", label: "Raw Material Shortage", count: shortageItemIds.size, href: "/reports/raw-material-shortage" }]),
    ...(selectedLine === "material_supply" ? [] : [{ key: "jobdelay", label: "Job Delayed", count: jobDelayedCount, href: "/reports/order-health" }]),
    { key: "deliveryoverdue", label: "Delivery Overdue", count: deliveryOverdueCount, href: "/reports/order-health" },
    { key: "acceptance", label: "Client Acceptance Pending", count: clientAcceptancePendingCount, href: "/delivery-challans?acceptance=Pending" },
    { key: "invoicepending", label: "Invoice Pending", count: pendingInvoiceLines.length, href: "/reports/pending-orders" },
    { key: "paymentoverdue", label: "Payment Overdue", count: overdueInvoiceRows.length, href: "/reports/ar-aging" },
  ];

  // ---------- Pending From Whom ----------
  const openPoCount = (purchaseOrdersAll ?? []).filter((p) => !["Received", "Closed", "Cancelled"].includes(p.status)).length;
  const fabricationPendingCount =
    selectedLine === "material_supply"
      ? 0
      : (jobsAll ?? []).filter((j) => {
          if (["Delivered", "Cancelled"].includes(j.status)) return false;
          const label = computeHealth({ isOpen: true, promisedDate: j.required_delivery_date, updatedAt: j.updated_at })?.label ?? "OnTrack";
          return label === "AtRisk" || label === "Stalled" || label === "Delayed";
        }).length;
  const clientPendingCount = (quotationsAll ?? []).filter((q) => q.status === "Sent").length;
  const accountsPendingCount = new Set(overdueInvoiceRows.map((r) => r.partyId)).size;

  type PendingBucket = { key: string; label: string; count: number; href: string };
  const pendingFromWhom: PendingBucket[] = [
    { key: "client", label: "Client", count: clientPendingCount, href: "/quotations?status=Sent" },
    { key: "supplier", label: "Supplier", count: openPoCount, href: "/purchase-orders?open=1" },
    ...(selectedLine === "material_supply"
      ? []
      : [{ key: "purchase", label: "Purchase", count: materialPendingJobCount, href: "/jobs?status=MaterialPending" }]),
    ...(selectedLine === "material_supply" ? [] : [{ key: "fabrication", label: "Fabrication", count: fabricationPendingCount, href: "/jobs?health=attention" }]),
    { key: "accounts", label: "Accounts", count: accountsPendingCount, href: "/reports/ar-aging" },
  ];

  // ---------- Management Charts ----------
  const buckets = buildTimeBuckets(from, to);
  const bucketLabels = buckets.map((b) => b.label);
  const trendSeries: TrendSeries[] = [
    { key: "queries", label: "Queries", color: "var(--ledger)", values: countInBuckets((queriesAll ?? []).map((q) => q.created_at), buckets) },
    {
      key: "quotations",
      label: "Quotations",
      color: "var(--accent)",
      values: countInBuckets((quotationsAll ?? []).filter((q) => q.status !== "Draft").map((q) => q.created_at), buckets),
    },
    {
      key: "po",
      label: "PO Received (Sales Order)",
      color: "var(--good)",
      values: countInBuckets((salesOrdersAll ?? []).filter((s) => matchesLine(s.business_line)).map((s) => s.created_at), buckets),
    },
  ];

  const activeMaterialSupplySoCount = (salesOrdersAll ?? []).filter(
    (s) => s.business_line === "material_supply" && !["Delivered", "Invoiced", "Closed", "Cancelled"].includes(s.status)
  ).length;
  const activeFabricationJobCount = (jobsAll ?? []).filter((j) => !["Delivered", "Cancelled"].includes(j.status)).length;
  const materialVsFabricationBars: CompareBar[] = [
    { key: "ms", label: "Material Supply Orders (Active)", value: activeMaterialSupplySoCount, color: "var(--ledger)" },
    { key: "fab", label: "Fabrication Jobs (In Progress)", value: activeFabricationJobCount, color: "var(--accent)" },
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
  const recentQueries = (queriesAll ?? []).slice(0, 6);
  const recentQuotations = (quotationsAll ?? []).slice(0, 6);
  const HEALTH_RANK: Record<HealthLabel, number> = { Delayed: 0, Stalled: 1, AtRisk: 2, OnTrack: 3 };
  const jobStatusRows = (jobsAll ?? [])
    .filter((j) => !["Delivered", "Cancelled"].includes(j.status))
    .map((j) => ({ ...j, health: computeHealth({ isOpen: true, promisedDate: j.required_delivery_date, updatedAt: j.updated_at }) }))
    .sort((a, b) => HEALTH_RANK[a.health?.label ?? "OnTrack"] - HEALTH_RANK[b.health?.label ?? "OnTrack"])
    .slice(0, 6);
  const pendingDeliveryRows = pendingDeliverLines
    .map((l) => ({ ...l, days: daysSince(l.po_date) }))
    .sort((a, b) => b.days - a.days)
    .slice(0, 6);
  const paymentFollowupRows = overdueInvoiceRows.slice(0, 6);

  const latestSnapshot = dailySnapshots?.[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Owner Dashboard</h1>
        <p className="mt-1 text-sm text-ink-soft">Business ka live management view — Sales, Fabrication, Accounts aur Owner action items ek jaga.</p>
      </div>

      <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-ink-faint font-mono">
            {resolved.label} — {from === to ? from : `${from} se ${to}`}
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
          Note: Query/Quotation ka business line Sales Order banne ke baad tay hota hai — Material Supply/Fabrication filter ka asar Sales
          Order, Job, Delivery aur Receivable numbers par hota hai; Queries, Quotations, Payables, Cash &amp; Bank aur Stock Value company-wide
          rehte hain.
        </p>
      </div>

      {/* ---------- TOP KPI CARDS ---------- */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <KpiCard realHref={`/queries?from=${from}&to=${to}`} value={queriesInRangeCount.toLocaleString()} label="Queries Received" />
        <KpiCard realHref={`/quotations?from=${from}&to=${to}`} value={quotationsSentInRange.length.toLocaleString()} label="Quotations Sent" />
        <KpiCard realHref={`/sales-orders?from=${from}&to=${to}`} value={salesOrdersInRange.length.toLocaleString()} label="PO Received" />
        <KpiCard realHref={`/quotations?from=${from}&to=${to}`} value={`${conversionPct}%`} label="Quotation → PO Conversion" />
        <KpiCard realHref="/reports/pending-orders" value={pendingDeliverLines.length.toLocaleString()} label="Pending Deliveries" tone={pendingDeliverLines.length > 0 ? "warn" : undefined} />
        <KpiCard realHref={`/payments?direction=receipt&from=${from}&to=${to}`} value={paymentsReceivedTotal.toLocaleString()} label="Payments Received" tone="good" />
        <KpiCard realHref="/reports/ar-aging" value={receivablesTotal.toLocaleString()} label="Receivables" tone={receivablesTotal > 0 ? "warn" : undefined} />
        <KpiCard realHref="/reports/ap-aging" value={payablesTotal.toLocaleString()} label="Payables" tone={payablesTotal > 0 ? "warn" : undefined} />
        <KpiCard realHref="/cash-bank" value={cashBankTotal.toLocaleString()} label="Cash &amp; Bank" tone="good" />
        <KpiCard realHref="/inventory" value={stockValueTotal.toLocaleString()} label="Raw Material Stock Value" />
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
            <p className="text-xs text-ink-faint">Yeh comparison sirf &quot;All&quot; view mein dikhta hai.</p>
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
            {recentQueries.map((q) => (
              <Link key={q.id} href={`/queries/${q.id}`} className="flex items-center justify-between px-4 py-2 text-sm hover:bg-surface-2 transition">
                <span className="text-ink-soft text-xs">
                  <span className="font-mono text-ink">{q.query_no}</span> — {(q.parties as unknown as PartyRef)?.legal_name ?? "—"}
                </span>
                <span className="text-ink-faint text-xs whitespace-nowrap">{q.status}</span>
              </Link>
            ))}
            {!recentQueries.length && <p className="px-4 py-4 text-center text-xs text-ink-faint">Koi query nahi hai.</p>}
          </div>
        </SectionCard>

        <SectionCard title="Recent Quotations" seeAllHref="/quotations">
          <div className="divide-y divide-line">
            {recentQuotations.map((q) => (
              <Link key={q.id} href={`/quotations/${q.id}`} className="flex items-center justify-between px-4 py-2 text-sm hover:bg-surface-2 transition">
                <span className="text-ink-soft text-xs">
                  <span className="font-mono text-ink">{q.quotation_no}</span> — {(q.parties as unknown as PartyRef)?.legal_name ?? "—"}
                </span>
                <span className="text-ink-faint text-xs whitespace-nowrap">{q.status}</span>
              </Link>
            ))}
            {!recentQuotations.length && <p className="px-4 py-4 text-center text-xs text-ink-faint">Koi quotation nahi hai.</p>}
          </div>
        </SectionCard>

        {selectedLine !== "material_supply" && (
          <SectionCard title="Fabrication Jobs Status" seeAllHref="/jobs">
            <div className="divide-y divide-line">
              {jobStatusRows.map((j) => {
                const so = j.sales_orders as unknown as { so_no: string; parties: PartyRef } | null;
                return (
                  <Link key={j.id} href={`/jobs/${j.id}`} className="flex items-center justify-between px-4 py-2 text-sm hover:bg-surface-2 transition">
                    <span className="text-ink-soft text-xs">
                      <span className="font-mono text-ink">{j.job_no}</span> — {so?.parties?.legal_name ?? "—"} ({j.progress_pct}%)
                    </span>
                    {j.health && (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${HEALTH_BADGE_STYLE[j.health.label]}`}>{HEALTH_LABEL_TEXT[j.health.label]}</span>
                    )}
                  </Link>
                );
              })}
              {!jobStatusRows.length && <p className="px-4 py-4 text-center text-xs text-ink-faint">Koi active Job nahi hai.</p>}
            </div>
          </SectionCard>
        )}

        <SectionCard title="Pending Deliveries" seeAllHref="/reports/pending-orders">
          <div className="divide-y divide-line">
            {pendingDeliveryRows.map((l, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-ink-soft text-xs">
                  <span className="font-mono text-ink">{l.so_no}</span> — {l.client}
                </span>
                <span className={`text-xs tabular ${l.days > 30 ? "text-bad font-medium" : "text-warn"}`}>{l.days} din se</span>
              </div>
            ))}
            {!pendingDeliveryRows.length && <p className="px-4 py-4 text-center text-xs text-ink-faint">Koi pending delivery nahi hai.</p>}
          </div>
        </SectionCard>

        <SectionCard title="Payment Follow-ups" seeAllHref="/reports/ar-aging">
          <div className="divide-y divide-line">
            {paymentFollowupRows.map((r) => (
              <Link key={r.invoiceId} href={`/clients/${r.partyId}`} className="flex items-center justify-between px-4 py-2 text-sm hover:bg-surface-2 transition">
                <span className="text-ink-soft text-xs">{r.client}</span>
                <span className="text-xs tabular text-bad font-medium">
                  {r.amount.toLocaleString()} ({r.overdueDays}d)
                </span>
              </Link>
            ))}
            {!paymentFollowupRows.length && <p className="px-4 py-4 text-center text-xs text-ink-faint">Koi overdue payment nahi hai.</p>}
          </div>
        </SectionCard>
      </div>

      {/* ---------- OWNER CONTROL SECTIONS ---------- */}
      <SectionCard title="Action Required">
        <div className="divide-y divide-line">
          {actionItems.map((item) => (
            <Link key={item.key} href={item.href} className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-surface-2 transition">
              <span className={item.count > 0 ? "text-ink" : "text-ink-faint"}>{item.label}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${item.count > 0 ? "bg-bad-soft text-bad" : "bg-surface-2 text-ink-faint"}`}>
                {item.count}
              </span>
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
            Poori History →
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
          <p className="text-sm text-ink-faint">Abhi koi Daily Snapshot generate nahi hui — pehla snapshot aaj raat 00:10 baje khud ban jayega.</p>
        )}
      </div>

      {/* ---------- REPORT DIRECTORY ---------- */}
      <div>
        <h2 className="text-sm font-semibold text-ink mb-3">Sab Reports</h2>
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
          <ReportLink href="/reports/daily-snapshot" title="Daily Snapshot" desc="Har din ka Cash/Bank/Stock/AR/AP position — khud-b-khud raat ko generate hota hai, manually bhi ban sakta hai." />
          <ReportLink href="/reports/credit-limit-warning" title="Credit Limit Warning" desc="Woh clients jinka outstanding Credit Limit ke 90% ya usse zyada tak pohanch gaya hai." />
          <ReportLink href="/reports/quotation-followups" title="Quotation Follow-up Due" desc="Sent quotations jinki linked Query par follow-up date aa/guzar chuki hai." />
          <ReportLink href="/reports/raw-material-shortage" title="Raw Material Shortage" desc="Woh items jinki kami ki wajah se Job(s) Material Pending par ruki hui hain." />
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  realHref,
  value,
  label,
  tone,
}: {
  realHref: string;
  value: string;
  label: string;
  tone?: "good" | "warn" | "bad";
}) {
  const toneClass = tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "good" ? "text-good" : "text-ink";
  return (
    <Link href={realHref} className="rounded-xl border border-line bg-surface p-4 hover:bg-surface-2 transition block">
      <p className={`text-2xl font-semibold tabular ${toneClass}`}>{value}</p>
      <p className="mt-0.5 text-xs text-ink-faint uppercase tracking-wide font-mono">{label}</p>
    </Link>
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
            Sab dekhen →
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
