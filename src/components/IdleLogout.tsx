"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { clearOfflineCaches } from "@/lib/clearOfflineCaches";
import { IDLE_LIMIT_MS, LAST_ACTIVE_COOKIE, REMEMBER_COOKIE, isSessionOnly, serializeCookie } from "@/lib/sessionPolicy";

function readCookie(name: string): string | undefined {
  for (const part of document.cookie.split("; ")) {
    const i = part.indexOf("=");
    if (part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return undefined;
}

const EVENTS = ["pointerdown", "pointermove", "keydown", "scroll", "touchstart", "wheel"] as const;
const WRITE_EVERY_MS = 20_000;
const CHECK_EVERY_MS = 30_000;

/**
 * For a user who did not tick "Keep me signed in": records real activity (mouse, keys, touch, scroll) in a
 * cookie, and signs out after an hour with none. Pages polling on their own do not count as activity.
 * Nothing runs for a user who kept their session. See lib/sessionPolicy.ts.
 */
export function IdleLogout({ idleSignOutAction }: { idleSignOutAction: () => Promise<void> }) {
  const router = useRouter();
  useEffect(() => {
    if (!isSessionOnly(readCookie(REMEMBER_COOKIE))) return;

    let lastWrite = 0;
    let signingOut = false;
    const touch = () => {
      const now = Date.now();
      if (now - lastWrite < WRITE_EVERY_MS) return;
      lastWrite = now;
      document.cookie = serializeCookie(LAST_ACTIVE_COOKIE, String(now), { secure: window.location.protocol === "https:" });
    };

    const check = async () => {
      if (signingOut) return;
      const last = Number(readCookie(LAST_ACTIVE_COOKIE));
      if (!last || Date.now() - last <= IDLE_LIMIT_MS) return;
      signingOut = true;
      await clearOfflineCaches();
      try {
        await idleSignOutAction();
      } catch {
        // the action redirects to /login; if it cannot, send the page there so nobody stays on a stale screen
      }
      router.replace("/login?reason=idle");
    };

    // Opening the app counts as activity; then wait for a real action.
    touch();
    for (const e of EVENTS) window.addEventListener(e, touch, { passive: true });
    const timer = setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      for (const e of EVENTS) window.removeEventListener(e, touch);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [idleSignOutAction, router]);

  return null;
}
