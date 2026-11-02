import { isOwner, hasRole, type CurrentUser } from "@/lib/auth";

/**
 * Who may see or set what an order costs us. Mirrors fn_sales_order_cost_summary /
 * fn_set_sales_order_estimated_cost and the sales_order_costs SELECT policy
 * (supabase/migrations/20261103100000_phase54_01_sales_order_cost.sql) — keep in sync.
 */
export function canSeeOrderCost(user: CurrentUser | null): boolean {
  return isOwner(user) || hasRole(user, "accounts");
}
