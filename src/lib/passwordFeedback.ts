// Turning Supabase Auth's weak-password signal into something a person can act on.
//
// Once "Prevent use of leaked passwords" is switched on in the Supabase
// dashboard (Authentication -> Providers -> Email), Auth reports a weak or
// breached password in TWO different shapes, and the app has to handle both:
//
//   1. Setting a password (sign-up, change password, the Owner creating or
//      resetting a user) is REJECTED. supabase-js raises an
//      AuthWeakPasswordError carrying `reasons`, and without this file the
//      user would see Supabase's own raw wording.
//
//   2. Signing in with a password that is already weak SUCCEEDS. This is worth
//      being precise about, because it is the opposite of what it sounds like:
//      in @supabase/auth-js the sign-in response runs through
//      `_sessionResponsePassword`, which saves the session, leaves `error` as
//      null, and attaches `data.weakPassword` instead. So turning the setting
//      on does NOT lock existing accounts out — but nobody is told anything
//      either, unless the app reads that field. It does now.
//
// The three reason codes are the complete set Auth defines
// (`WeakPasswordReasons` in @supabase/auth-js: "length" | "characters" |
// "pwned"); any unrecognised code falls back to the generic sentence rather
// than being dropped silently.

/** Set at sign-in when Auth reports the password the user just used is weak. */
export const WEAK_PASSWORD_COOKIE = "app_weak_password";

const REASON_TEXT: Record<string, string> = {
  pwned: "it has appeared in a known public data breach",
  length: "it is too short",
  characters: "it doesn't mix enough different kinds of character",
};

function joinReasons(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Why a password was refused, phrased for the person who typed it. */
export function weakPasswordMessage(reasons: readonly string[] | null | undefined): string {
  const known = (reasons ?? []).map((r) => REASON_TEXT[r]).filter(Boolean);
  if (!known.length) {
    return "This password doesn't meet the security requirements. Please choose a different one.";
  }
  return `This password can't be used because ${joinReasons(known)}. Please choose a different one.`;
}

/** The same sentence, addressed to someone who is already signed in with it. */
export function weakPasswordWarning(reasons: readonly string[] | null | undefined): string {
  const known = (reasons ?? []).map((r) => REASON_TEXT[r]).filter(Boolean);
  if (!known.length) {
    return "Your password no longer meets the security requirements.";
  }
  return `Your password should be changed because ${joinReasons(known)}.`;
}

/**
 * The reason codes carried by a rejected-password error, or null if this is
 * some other error entirely. Both shapes are accepted: `AuthWeakPasswordError`
 * (which sets `name` and `reasons`) and the plain error code Auth returns on
 * newer API versions.
 */
export function weakPasswordErrorReasons(error: unknown): string[] | null {
  if (!error || typeof error !== "object") return null;
  const e = error as { name?: unknown; code?: unknown; reasons?: unknown };
  const isWeak = e.name === "AuthWeakPasswordError" || e.code === "weak_password";
  if (!isWeak) return null;
  return Array.isArray(e.reasons) ? e.reasons.filter((r): r is string => typeof r === "string") : [];
}

/**
 * The app's own message for a rejected password, or null if this error is
 * about something else and should be reported as it is.
 */
export function weakPasswordErrorMessage(error: unknown): string | null {
  const reasons = weakPasswordErrorReasons(error);
  return reasons === null ? null : weakPasswordMessage(reasons);
}

/** Serialise reasons for the sign-in cookie, and read them back. */
export function encodeWeakPasswordReasons(reasons: readonly string[]): string {
  return reasons.filter((r) => /^[a-z_]+$/.test(r)).join(",");
}

export function decodeWeakPasswordReasons(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").filter((r) => /^[a-z_]+$/.test(r));
}
