import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";
import { REMEMBER_COOKIE, isSessionOnly, serializeCookie, withoutLifetime } from "@/lib/sessionPolicy";

function readCookies(): { name: string; value: string }[] {
  if (typeof document === "undefined" || !document.cookie) return [];
  return document.cookie.split("; ").map((part) => {
    const i = part.indexOf("=");
    const name = i < 0 ? part : part.slice(0, i);
    const raw = i < 0 ? "" : part.slice(i + 1);
    let value = raw;
    try {
      value = decodeURIComponent(raw);
    } catch {
      // keep the raw value
    }
    return { name, value };
  });
}

/**
 * Browser-side Supabase client. Use this in Client Components only.
 * It carries the signed-in user's session — every query still goes
 * through Row Level Security, never a service-role key.
 *
 * It reads and writes the sign-in cookies itself so that, for a user who did not tick "Keep me signed in",
 * a token refresh in the browser keeps them as session cookies (the library would otherwise give them a
 * 400-day life again). See lib/sessionPolicy.ts.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return readCookies();
        },
        setAll(cookiesToSet) {
          const sessionOnly = isSessionOnly(readCookies().find((c) => c.name === REMEMBER_COOKIE)?.value);
          for (const { name, value, options } of cookiesToSet) {
            document.cookie = serializeCookie(name, value, (sessionOnly ? withoutLifetime(options) : options) ?? {});
          }
        },
      },
    }
  );
}
