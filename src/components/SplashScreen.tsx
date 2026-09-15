"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
// Static import (rather than a string src) so Next.js reads the file's real
// dimensions at build time, reserves the exact box before the bytes arrive
// (no layout shift, no logo jumping into place) and generates an automatic
// blur placeholder from it.
//
// `oht-logo-mark.png` is the official logo asset with its transparent
// canvas trimmed away — an exact sub-rectangle of `oht-logo.png` (verified
// byte-identical, offset 117,367). The original file carries ~22k pixels at
// 0.4-4.7% opacity around the artwork: invisible to the eye, but the browser
// still counts them in the element box, which inflated the logo's apparent
// bounds from its true 997x522 (a wide 1.9:1 lockup) to 1201x1160 (nearly
// square). That phantom padding is why a card sized around the logo came out
// far too tall, and why a logo sized to "295px" only ever showed ~236px of
// real artwork. Nothing about the artwork itself is altered.
import ohtLogo from "../../public/oht-logo-mark.png";

// OHT Solutions branding splash — shown for a brief moment on a genuine fresh
// page load. RootLayout only ever mounts once per real document load; a
// client-side navigation between app pages never remounts it, so this never
// reappears while moving around inside the app, only on a real cold open.
//
// Duration is driven by real readiness, not an artificial timer: it waits for
// the page to actually finish loading (the browser's own `load` event —
// already-fired if this mounts late) and only THEN checks whether
// MIN_VISIBLE_MS has elapsed, extending the wait if not. A slow cold start is
// never cut short; a fast one never lingers past the minimum.
const MIN_VISIBLE_MS = 1800;
const FADE_MS = 280;

export function SplashScreen({ appVersion }: { appVersion: string }) {
  const [phase, setPhase] = useState<"visible" | "fading" | "hidden">("visible");

  useEffect(() => {
    const mountedAt = Date.now();
    let cancelled = false;

    function startHide() {
      if (cancelled) return;
      const remaining = Math.max(0, MIN_VISIBLE_MS - (Date.now() - mountedAt));
      setTimeout(() => {
        if (cancelled) return;
        setPhase("fading");
        setTimeout(() => {
          if (!cancelled) setPhase("hidden");
        }, FADE_MS);
      }, remaining);
    }

    if (document.readyState === "complete") {
      startHide();
    } else {
      window.addEventListener("load", startHide, { once: true });
    }

    return () => {
      cancelled = true;
      window.removeEventListener("load", startHide);
    };
  }, []);

  if (phase === "hidden") return null;

  return (
    <div
      className="splash"
      data-phase={phase}
      aria-hidden={phase === "fading"}
      style={{ transitionDuration: `${FADE_MS}ms` }}
    >
      {/* Light theme only (hidden in dark) — barely-there cream shapes. */}
      <div className="splash-deco" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      {/* In light mode this is just the bare logo on the cream background.
          In dark mode the same element becomes a compact light card, which
          is what keeps the logo's own navy ink legible without touching the
          artwork — see the splash block in globals.css. */}
      <div className="splash-slot">
        <Image
          src={ohtLogo}
          alt="OHT Solutions"
          placeholder="blur"
          priority
          sizes="(min-width: 1024px) 470px, (min-width: 600px) 343px, 90vw"
          className="splash-logo"
        />
      </div>

      <div className="splash-loader">
        <svg className="splash-spinner" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle className="splash-spinner-track" cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="3" />
          <path d="M21.5 12a9.5 9.5 0 0 0-9.5-9.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <p className="splash-text">Loading your workspace&hellip;</p>
      </div>

      <div className="splash-foot">
        <span>Version {appVersion}</span>
        <span>Powered by OHT Solutions</span>
      </div>
    </div>
  );
}
