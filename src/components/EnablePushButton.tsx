"use client";

import { useState } from "react";
import { BellRing } from "lucide-react";
import { buttonClass } from "@/components/ui/Button";
import { saveSubscriptionAction } from "@/app/actions/pushSubscriptions";

// Push's applicationServerKey wants the VAPID public key as raw bytes, not
// the base64url string env vars carry it as.
function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function isSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/**
 * Renders only while push is worth offering: supported by this
 * browser/device, VAPID key present, and permission not already decided
 * either way (a prior "block" is the browser's own decision to respect,
 * not something to nag about; a prior "grant" means EnablePushOnLoad
 * below already re-subscribed silently on this load).
 */
export function EnablePushButton({ className = "" }: { className?: string }) {
  // Lazy initializer, same pattern as InstallAppButton.tsx's `installed`
  // state: this is a one-time read of client-only globals at mount, not a
  // value to keep re-deriving from props/state, so it belongs in state
  // rather than an effect that would just call setState once and never
  // again.
  const [visible, setVisible] = useState(
    () => isSupported() && !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && Notification.permission === "default"
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!visible) return null;

  async function enable() {
    setError(null);
    setPending(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setVisible(false);
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!) as BufferSource,
      });
      const json = subscription.toJSON();
      const res = await saveSubscriptionAction(json.endpoint!, json.keys!.p256dh, json.keys!.auth);
      if (res.error) setError(res.error);
      else setVisible(false);
    } catch {
      setError("Could not enable notifications on this device.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-1">
      <button type="button" onClick={enable} disabled={pending} className={className || buttonClass("secondary", "sm", "w-full gap-1.5")}>
        <BellRing size={13} /> {pending ? "Enabling…" : "Enable Notifications"}
      </button>
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}
