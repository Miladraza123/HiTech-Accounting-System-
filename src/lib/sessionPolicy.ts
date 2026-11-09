// "Keep me signed in" and the 1-hour idle sign-out.
//
//  * At sign-in the user can tick "Keep me signed in". The choice is stored in a small cookie (REMEMBER_COOKIE:
//    "1" = keep, "0" = do not). A session with NO such cookie (everyone already signed in before this existed)
//    behaves exactly as before.
//  * Not kept ("0"): the sign-in cookies are session cookies (they end when the browser or app is closed) and
//    the session ends after IDLE_LIMIT_MS without the user doing anything.
//  * "Doing anything" is recorded by the page itself (mouse, keys, touch, scroll) in LAST_ACTIVE_COOKIE.
//    Requests made by the page on its own (auto refresh, polling) do not count, so an idle tab still signs out.
//    The proxy only CHECKS that cookie, with a few minutes of slack, as a backstop when the page was closed or
//    the device was asleep.

export const REMEMBER_COOKIE = "hitech_remember";
export const LAST_ACTIVE_COOKIE = "hitech_last_active";
export const IDLE_LIMIT_MS = 60 * 60 * 1000;
export const IDLE_GRACE_MS = 5 * 60 * 1000;
/** How long a kept ("1") choice lasts, the same as the sign-in cookies themselves. */
export const REMEMBER_MAX_AGE_S = 400 * 24 * 60 * 60;

/** The user did not tick "Keep me signed in": session cookies and the idle limit apply. */
export function isSessionOnly(remember: string | null | undefined): boolean {
  return remember === "0";
}

/** Has a session-only user been idle longer than the limit (plus the server's slack)? */
export function isIdleExpired(
  remember: string | null | undefined,
  lastActive: string | null | undefined,
  now: number = Date.now(),
  limitMs: number = IDLE_LIMIT_MS + IDLE_GRACE_MS
): boolean {
  if (!isSessionOnly(remember)) return false;
  const last = Number(lastActive);
  if (!lastActive || !Number.isFinite(last) || last <= 0) return false; // nothing recorded yet: do not guess
  return now - last > limitMs;
}

type CookieOptionsLike = { maxAge?: number; expires?: Date | number | string; [k: string]: unknown };

/** Session-only cookies carry no lifetime, so they end with the browser. A deletion (maxAge 0) is left alone. */
export function withoutLifetime<T extends CookieOptionsLike>(options: T | undefined): T | undefined {
  if (!options) return options;
  if (options.maxAge === 0) return options;
  const { maxAge: _maxAge, expires: _expires, ...rest } = options;
  void _maxAge;
  void _expires;
  return rest as T;
}

/** A Set-Cookie string for document.cookie (the browser side has no cookie library). */
export function serializeCookie(name: string, value: string, options: CookieOptionsLike = {}): string {
  let s = `${name}=${encodeURIComponent(value)}`;
  s += `; Path=${typeof options.path === "string" ? options.path : "/"}`;
  if (typeof options.domain === "string" && options.domain) s += `; Domain=${options.domain}`;
  if (typeof options.maxAge === "number") s += `; Max-Age=${Math.floor(options.maxAge)}`;
  if (options.expires !== undefined) s += `; Expires=${new Date(options.expires as never).toUTCString()}`;
  const same = typeof options.sameSite === "string" ? options.sameSite : "lax";
  s += `; SameSite=${same.charAt(0).toUpperCase()}${same.slice(1).toLowerCase()}`;
  if (options.secure) s += "; Secure";
  return s;
}
