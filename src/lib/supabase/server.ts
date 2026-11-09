import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";
import { REMEMBER_COOKIE, isSessionOnly, withoutLifetime } from "@/lib/sessionPolicy";

/**
 * Server-side Supabase client for Server Components, Server Actions and
 * Route Handlers. `cookies()` is async as of Next.js 16.
 *
 * A user who did not tick "Keep me signed in" gets session cookies (no lifetime), so they end when the
 * browser closes. `sessionOnly` overrides the stored choice: the sign-in action passes it because the choice
 * cookie is not there yet on that very request. See lib/sessionPolicy.ts.
 */
export async function createClient(opts?: { sessionOnly?: boolean }) {
  const cookieStore = await cookies();
  const sessionOnly = opts?.sessionOnly ?? isSessionOnly(cookieStore.get(REMEMBER_COOKIE)?.value);

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, sessionOnly ? withoutLifetime(options) : options);
            }
          } catch {
            // Called from a Server Component that can't set cookies — the
            // proxy (src/proxy.ts) refreshes the session instead.
          }
        },
      },
    }
  );
}
