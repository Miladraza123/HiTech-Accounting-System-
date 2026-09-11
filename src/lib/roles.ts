// Pure, client-safe constants split out of lib/auth.ts (which imports
// next/headers via the server Supabase client and therefore can't be
// imported from Client Components).
export const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  sales: "Sales / CRM",
  store: "Store / Purchase",
  production: "Production",
  accounts: "Accounts",
  dispatch: "Dispatch",
  auditor: "Auditor",
};
