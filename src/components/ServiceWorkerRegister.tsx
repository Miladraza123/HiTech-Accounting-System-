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

    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
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
      })
      .catch(() => {
        // Offline support is a progressive enhancement — a registration
        // failure (unsupported browser, blocked storage, etc.) should
        // never break the app itself.
      });
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
