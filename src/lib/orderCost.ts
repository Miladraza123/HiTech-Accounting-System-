// Pure helpers for the Sales Order cost panel (no server-only imports, so client components can use them).

export type OrderCostSummary = {
  sales_subtotal: number;
  estimated_cost: number | null;
  po_cost: number;
  po_count: number;
  job_cost: number;
  actual_cost: number;
  estimated_profit: number | null;
  actual_profit: number;
};

/** Profit as a percentage of the selling value; null when there is nothing to divide by. */
export function marginPct(profit: number | null, sales: number): number | null {
  if (profit === null || !Number.isFinite(profit) || !sales) return null;
  return Math.round((profit / sales) * 1000) / 10;
}

/** Defensive read of the jsonb the cost-summary function returns. */
export function parseCostSummary(value: unknown): OrderCostSummary | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const num = (x: unknown) => (x === null || x === undefined ? null : Number(x));
  const sales = num(v.sales_subtotal);
  if (sales === null || Number.isNaN(sales)) return null;
  return {
    sales_subtotal: sales,
    estimated_cost: num(v.estimated_cost),
    po_cost: num(v.po_cost) ?? 0,
    po_count: num(v.po_count) ?? 0,
    job_cost: num(v.job_cost) ?? 0,
    actual_cost: num(v.actual_cost) ?? 0,
    estimated_profit: num(v.estimated_profit),
    actual_profit: num(v.actual_profit) ?? 0,
  };
}
