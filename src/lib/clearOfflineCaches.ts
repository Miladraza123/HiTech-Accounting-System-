// Wipes the service worker's page cache before logout, so the signed-in HTML
// it holds (see public/sw.js, v14 -> v15) is never served to whoever uses
// this device next. Asks the active worker to do it (it also re-precaches
// offline.html), and falls back to deleting the caches straight from the
// page when there is no worker or it doesn't answer in time. Best-effort:
// it never throws, and never delays logout by more than CLEAR_TIMEOUT_MS.
const CLEAR_TIMEOUT_MS = 2000;

async function deleteFromPage() {
  if (typeof caches === "undefined") return;
  const keys = await caches.keys();
  await Promise.all(keys.map((key) => caches.delete(key)));
}

export async function clearOfflineCaches(): Promise<void> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      await deleteFromPage();
      return;
    }
    const registration = await navigator.serviceWorker.getRegistration();
    const worker = registration?.active;
    if (!worker) {
      await deleteFromPage();
      return;
    }
    const cleared = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), CLEAR_TIMEOUT_MS);
      const onMessage = (event: MessageEvent) => {
        if (!event.data || event.data.type !== "CACHES_CLEARED") return;
        clearTimeout(timer);
        navigator.serviceWorker.removeEventListener("message", onMessage);
        resolve(event.data.ok === true);
      };
      navigator.serviceWorker.addEventListener("message", onMessage);
      worker.postMessage({ type: "CLEAR_CACHES" });
    });
    if (!cleared) await deleteFromPage();
  } catch {
    // Never block logout on cache housekeeping.
  }
}
