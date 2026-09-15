"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
// Static import (rather than a string src) so Next.js reads the file's
// real dimensions at build time and generates an automatic blur
// placeholder from it — the logo never has a moment of showing as an
// empty box while its bytes are still in flight, even on a slow
// connection.
import ohtLogo from "../../public/oht-logo.png";

// OHT Solutions branding splash — shown for a brief moment on a genuine
// fresh page load (RootLayout only ever mounts once per real document
// load; a client-side navigation between app pages never remounts it,
// so this naturally never reappears while someone is just moving around
// inside the app).
//
// Duration is driven by real readiness, not an artificial timer: it
// waits for the underlying page to actually finish loading (the
// browser's own `load` event — already-fired if this mounts late) and
// only THEN checks whether MIN_VISIBLE_MS has elapsed, extending the
// wait if not. A slow cold start (real init taking longer than the
// minimum) is never cut short; a fast one never lingers past the
// minimum just to feel "deliberate" — that's exactly what MIN_VISIBLE_MS
// alone would risk.
const MIN_VISIBLE_MS = 1600;
const FADE_MS = 320;

export function SplashScreen({ appVersion }: { appVersion: string }) {
  const [phase, setPhase] = useState<"visible" | "fading" | "hidden">("visible");

  useEffect(() => {
    const mountedAt = Date.now();
    let cancelled = false;

    function startHide() {
      if (cancelled) return;
      const elapsed = Date.now() - mountedAt;
      const remaining = Math.max(0, MIN_VISIBLE_MS - elapsed);
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
      aria-hidden={phase === "fading"}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden bg-bg px-4 transition-opacity ease-out"
      style={
        {
          opacity: phase === "fading" ? 0 : 1,
          transitionDuration: `${FADE_MS}ms`,
          // The splash always renders in the light palette, regardless of
          // the device/app dark-mode preference — the official logo's own
          // navy/blue ink has no white card behind it to sit on anymore,
          // so it needs a light backdrop to stay legible (verified: on
          // the dark palette it was nearly unreadable). These are the
          // exact light-mode values from globals.css's bare :root block,
          // scoped locally so every bg-*/text-* utility below resolves to
          // them without touching the app's real dark mode anywhere else.
          "--bg": "#f6f3ec",
          "--surface-2": "#efeae0",
          "--accent": "#a85a28",
          "--accent-soft": "#f0dec9",
          "--ink-soft": "#565b68",
          "--ink-faint": "#8b8f99",
        } as React.CSSProperties
      }
    >
      {/* Very subtle decorative cream/beige blobs, derived from the same
          theme tokens the rest of the app uses (no new colors) — purely
          background texture, kept well clear of the logo and text so it
          never reads as busy. */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -top-24 -left-20 h-72 w-72 rounded-full bg-accent-soft opacity-50 blur-3xl" />
        <div className="absolute -right-16 -bottom-28 h-80 w-80 rounded-full bg-accent-soft opacity-40 blur-3xl" />
        <div className="absolute bottom-16 -left-12 h-40 w-40 rounded-full bg-surface-2 opacity-60 blur-2xl" />
      </div>

      <div className="relative flex w-full max-w-sm flex-1 -translate-y-4 flex-col items-center justify-center gap-8 sm:-translate-y-6">
        {/* Logo asset used exactly as provided — no recoloring, no
            redrawing, no cropping, no background box behind it. The PNG
            already has a real transparent background, so it sits
            directly on the splash's cream backdrop, matching the
            reference design. */}
        <div className="splash-logo-in w-44 sm:w-52 md:w-56">
          <Image
            src={ohtLogo}
            alt="OHT Solutions"
            placeholder="blur"
            priority
            className="h-auto w-full object-contain"
          />
        </div>

        <div className="flex flex-col items-center gap-3">
          {/* Minimal spinner — thin ring, accent color, no heavy motion. */}
          <svg className="h-5 w-5 animate-spin text-accent" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          <p className="text-xs text-ink-soft">Loading your workspace…</p>
        </div>
      </div>

      <div className="relative flex w-full max-w-sm items-center justify-between pb-6 text-[11px] text-ink-faint">
        <span>Version {appVersion}</span>
        <span>Powered by OHT Solutions</span>
      </div>
    </div>
  );
}
