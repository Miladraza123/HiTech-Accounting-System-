// A trivial same-origin endpoint the client uses to actively verify real
// network connectivity — see OfflineQueueProvider.tsx. `navigator.onLine`
// and the browser's `online`/`offline` events only reflect whether the
// device has an active network *interface* (e.g. Wi-Fi/cellular radio is
// up), not whether it can actually reach anything — on some mobile
// carriers/proxies it reports `false` even with a perfectly working
// internet connection. A successful fetch here is the real signal.
export const dynamic = "force-dynamic";

export async function GET() {
  return new Response("ok", {
    status: 200,
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  });
}
