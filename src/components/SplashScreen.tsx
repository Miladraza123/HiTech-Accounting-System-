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
const MIN_VISIBLE_MS = 900;
const FADE_MS = 280;

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
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-bg px-4 transition-opacity ease-out"
      style={{ opacity: phase === "fading" ? 0 : 1, transitionDuration: `${FADE_MS}ms` }}
    >
      <div className="flex flex-1 flex-col items-center justify-center gap-5">
        {/* Logo asset used exactly as provided — no recoloring, no
            redrawing, no cropping. Its own white background is kept
            intact (it sits inside a white card, matching the same
            surface-on-cream language the login page itself already
            uses for its form card). */}
        <div
          className="splash-logo-in overflow-hidden rounded-2xl border border-line bg-surface shadow-sm"
          style={{ width: 132, height: 132 }}
        >
          <Image src={ohtLogo} alt="OHT Solutions" placeholder="blur" priority className="h-full w-full object-contain" />
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

      <div className="flex w-full max-w-sm items-center justify-between pb-6 text-[11px] text-ink-faint">
        <span>Version {appVersion}</span>
        <span>Powered by &quot;OHT Solutions&quot;</span>
      </div>
    </div>
  );
}
