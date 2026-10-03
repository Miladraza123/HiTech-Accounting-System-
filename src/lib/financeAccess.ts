import { isOwner, hasRole, type CurrentUser } from "@/lib/auth";

// Who may read which finance documents. Mirrors the SELECT policies in
// supabase/migrations/20261001180000_phase38_04_restrict_finance_table_reads.sql
// — keep the two in sync. Used to hide nav items, guard pages, and hide
// sections that would otherwise show a misleading 0 for roles RLS filters out.

/** Payments, expenses, fund transfers, bank/petty-cash accounts, job costs. */
export function canSeeFinance(user: CurrentUser | null): boolean {
  return isOwner(user) || hasRole(user, "accounts") || hasRole(user, "auditor");
}

/** Invoices and sales returns (and client receivables). */
export function canSeeInvoices(user: CurrentUser | null): boolean {
  return canSeeFinance(user) || hasRole(user, "sales");
}

/** Supplier bills and purchase returns (and supplier payables). */
export function canSeeSupplierBills(user: CurrentUser | null): boolean {
  return canSeeFinance(user) || hasRole(user, "store");
}
