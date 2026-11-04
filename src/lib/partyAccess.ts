import { isOwner, hasRole, type CurrentUser } from "@/lib/auth";

/**
 * Who may change a client/supplier's details and contacts. Mirrors the UPDATE/INSERT policies on
 * parties and party_contacts (Owner, Sales, Store) — keep in sync. Removing a contact is Owner-only (DELETE policy).
 */
export function canEditParty(user: CurrentUser | null): boolean {
  return isOwner(user) || hasRole(user, "sales") || hasRole(user, "store");
}
