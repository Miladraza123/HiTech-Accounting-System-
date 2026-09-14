"use client";

import { useEffect, useState } from "react";

// Registers the PWA service worker (public/sw.js) and shows a small toast
// whenever a NEW version has finished installing in the background —
// the user decides when to reload (via the "Refresh" button), rather than
// the app silently swapping code out from under them mid-edit.
export function ServiceWorkerRegister() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    let activeRegistration: ServiceWorkerRegistration | null = null;

    function watchForUpdate(registration: ServiceWorkerRegistration) {
      // A worker was already waiting when this tab loaded (e.g. it
      // installed in another tab).
      if (registration.waiting) setWaitingWorker(registration.waiting);

      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            setWaitingWorker(installing);
          }
        });
      });
    }

    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        activeRegistration = registration;
        watchForUpdate(registration);
      })
      .catch(() => {
        // Offline support is a progressive enhancement — a registration
        // failure (unsupported browser, blocked storage, etc.) should
        // never break the app itself.
      });

    // An installed PWA opened from its home-screen icon is very often
    // resuming an already-running, backgrounded process rather than
    // performing a genuine fresh page navigation — no network request
    // happens at all in that case. The browser's own automatic update
    // check normally piggybacks on navigations (or an internal ~24h
    // timer), so on a PWA that's mostly reopened rather than freshly
    // loaded, a real fix already live on the server could sit
    // undetected indefinitely, no matter how many times the user closes
    // and reopens the app. Forcing an explicit check whenever the app
    // becomes visible again closes that gap — this is what actually
    // makes the "new version available" toast below show up promptly on
    // a resumed PWA instead of only on a true cold start.
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        activeRegistration?.update().catch(() => {});
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // visibilitychange alone still misses a real case: a regular browser
    // tab that's simply left open and stays the active/visible tab the
    // whole time (never actually hidden — no tab switch, no minimize) —
    // visibilitychange never fires there at all, so a tab someone just
    // keeps open for a long session could sit on old code indefinitely
    // with no re-check ever triggered. A periodic timer closes that last
    // gap unconditionally, independent of any visibility transition.
    const interval = setInterval(() => {
      activeRegistration?.update().catch(() => {});
    }, 5 * 60 * 1000);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearInterval(interval);
    };
  }, []);

  if (!waitingWorker) return null;

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-full max-w-sm items-center justify-between gap-3 rounded-lg border border-line-strong bg-surface px-4 py-3 text-sm shadow-lg">
      <span className="text-ink">A new version is available.</span>
      <button
        type="button"
        onClick={() => {
          waitingWorker.postMessage("SKIP_WAITING");
          setWaitingWorker(null);
        }}
        className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition"
      >
        Refresh
      </button>
    </div>
  );
}
