import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Privileged Supabase client using the Service Role key — bypasses RLS
 * entirely and can call the Auth Admin API (`auth.admin.*`). Server-only:
 * never import this from a Client Component, and never expose
 * `SUPABASE_SERVICE_ROLE_KEY` via a `NEXT_PUBLIC_*` name. Currently used
 * for exactly one thing: instantly creating a teammate's login (Setup >
 * Users & Roles > New User) with a password the Owner sets, instead of
 * making them self-serve through /signup — see createUserAction.
 *
 * Unlike `src/lib/supabase/server.ts`, this client is NOT cookie-based
 * and carries no end-user session; every call it makes runs with full
 * admin privileges, so every caller of this module must do its own
 * permission check (e.g. `isOwner(currentUser)`) before using it.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured — instant user creation is unavailable until it's added to the environment."
    );
  }
  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
