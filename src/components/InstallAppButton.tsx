"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { buttonClass } from "@/components/ui/Button";

// Not in lib.dom.d.ts yet — Chrome/Edge/Android fire this before showing
// their own native "Add to Home Screen" prompt.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * "Install App" — captures the browser's `beforeinstallprompt` event
 * (Chrome/Edge/Android) so the PWA can be installed with one tap instead
 * of the user having to find the browser's own menu option. iOS Safari
 * never fires that event (Apple doesn't support it), so there it shows
 * the manual Share > Add to Home Screen steps instead. Renders nothing
 * once already installed, or on a browser/state where installing isn't
 * currently offered — never a broken or no-op button.
 */
export function InstallAppButton({ className = "" }: { className?: string }) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => isStandalone());
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    function handleBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }
    function handleAppInstalled() {
      setInstalled(true);
      setDeferredPrompt(null);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  if (installed) return null;
  // Nothing to offer here: not iOS, and the browser never fired
  // beforeinstallprompt (already installed elsewhere, criteria not met
  // yet, or a browser that doesn't support install prompts at all).
  if (!deferredPrompt && !isIos()) return null;

  async function handleClick() {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
      setDeferredPrompt(null);
    } else if (isIos()) {
      setShowIosHelp(true);
    }
  }

  return (
    <>
      <button type="button" onClick={handleClick} className={className || buttonClass("secondary", "sm", "w-full gap-1.5")}>
        <Download size={13} /> Install App
      </button>

      {showIosHelp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setShowIosHelp(false)}
        >
          <div
            className="w-full max-w-xs rounded-xl border border-line bg-surface p-5 space-y-3 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-ink">Install on iPhone/iPad</p>
            <ol className="list-decimal list-inside space-y-1.5 text-sm text-ink-soft">
              <li>Tap the Share icon in Safari&apos;s toolbar.</li>
              <li>Scroll down and tap &quot;Add to Home Screen&quot;.</li>
              <li>Tap &quot;Add&quot; — the app icon appears on your home screen.</li>
            </ol>
            <button type="button" onClick={() => setShowIosHelp(false)} className={buttonClass("secondary", "sm", "w-full")}>
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
