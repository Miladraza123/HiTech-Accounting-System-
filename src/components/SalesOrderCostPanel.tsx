"use client";

import { useState, useTransition } from "react";
import { setSalesOrderEstimatedCostAction } from "@/app/actions/salesOrders";
import { parseEstimatedCost } from "@/components/EstimatedCostField";
import { marginPct, type OrderCostSummary } from "@/lib/orderCost";

function rs(n: number) {
  return n.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Profit({ profit, sales }: { profit: number | null; sales: number }) {
  if (profit === null) return <span className="text-ink-faint">—</span>;
  const pct = marginPct(profit, sales);
  return (
    <span className={profit < 0 ? "text-bad font-medium" : "text-good font-medium"}>
      {rs(profit)}
      {pct !== null && <span className="ml-1 text-xs">({pct}%)</span>}
    </span>
  );
}

/**
 * Owner/Accounts only (the page never renders it for anyone else). Shows what the order sells for next to
 * what we expect it to cost and what it has cost so far (linked non-cancelled Purchase Orders + fabrication
 * job costs), and lets the estimate be written or changed at any time.
 */
export function SalesOrderCostPanel({ salesOrderId, summary, canEdit }: { salesOrderId: string; summary: OrderCostSummary; canEdit: boolean }) {
  const [value, setValue] = useState(summary.estimated_cost === null ? "" : String(summary.estimated_cost));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    setSaved(false);
    const parsed = parseEstimatedCost(value);
    if (parsed === undefined) {
      setError("Enter a valid amount (0 or more).");
      return;
    }
    startTransition(async () => {
      const res = await setSalesOrderEstimatedCostAction(salesOrderId, parsed);
      if (res.error) setError(res.error);
      else setSaved(true);
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-ink">Cost &amp; Profit</h2>
        <p className="text-[11px] text-ink-faint">Visible to Owner and Accounts only. All figures are before tax.</p>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
        <dt className="text-ink-soft">Selling value</dt>
        <dd className="text-right tabular text-ink">{rs(summary.sales_subtotal)}</dd>

        <dt className="text-ink-soft">Estimated cost</dt>
        <dd className="text-right tabular text-ink">{summary.estimated_cost === null ? <span className="text-ink-faint">not set</span> : rs(summary.estimated_cost)}</dd>

        <dt className="text-ink-soft">Estimated profit</dt>
        <dd className="text-right tabular">
          <Profit profit={summary.estimated_profit} sales={summary.sales_subtotal} />
        </dd>

        <dt className="col-span-2 mt-1 border-t border-line pt-2 text-xs font-mono uppercase tracking-wide text-ink-faint">Actual so far</dt>

        <dt className="text-ink-soft">
          Purchase Orders <span className="text-xs text-ink-faint">({summary.po_count} linked)</span>
        </dt>
        <dd className="text-right tabular text-ink">{rs(summary.po_cost)}</dd>

        <dt className="text-ink-soft">Fabrication job costs</dt>
        <dd className="text-right tabular text-ink">{rs(summary.job_cost)}</dd>

        <dt className="font-medium text-ink">Actual cost</dt>
        <dd className="text-right tabular font-medium text-ink">{rs(summary.actual_cost)}</dd>

        <dt className="text-ink-soft">Actual profit</dt>
        <dd className="text-right tabular">
          <Profit profit={summary.actual_profit} sales={summary.sales_subtotal} />
        </dd>
      </dl>

      {canEdit && (
        <div className="space-y-1.5 border-t border-line pt-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-ink-soft">Estimated cost (Rs)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setSaved(false);
              }}
              className="input tabular"
              placeholder="Leave empty to clear"
            />
          </label>
          {error && <p className="text-xs text-bad">{error}</p>}
          {saved && <p className="text-xs text-good">Saved.</p>}
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save estimate"}
          </button>
        </div>
      )}
    </div>
  );
}
