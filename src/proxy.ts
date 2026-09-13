import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/supabase/database.types";

// Next.js 16 renamed `middleware.ts` -> `proxy.ts` and the exported
// `middleware()` function -> `proxy()`. This runs on the Node runtime
// (no edge) on every request to keep the Supabase auth session fresh and
// to gate access to the authenticated part of the app.
const PUBLIC_PATHS = ["/login", "/signup", "/auth"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p)) || path.startsWith("/_next");

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectedFrom", path);
    return NextResponse.redirect(url);
  }

  if (user && (path === "/login" || path === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // sw.js/manifest.webmanifest/offline.html must never require auth — the
  // service worker has to register (and its offline fallback has to load)
  // for a signed-out visitor and a signed-in one alike.
  //
  // api/ping must also skip this entirely — it exists purely as a cheap,
  // dependency-free "can I reach my own server" probe for
  // OfflineQueueProvider's real-connectivity check. Routing it through
  // this proxy would make every offline/online decision depend on a
  // supabase.auth.getUser() round-trip to Supabase's own Auth API on
  // every check — an unrelated failure or slow response there (nothing
  // to do with the user's own device connectivity) would then show a
  // false "Offline" banner while the user is genuinely online.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|offline\\.html|api/ping|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
