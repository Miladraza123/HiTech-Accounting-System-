"use client";

import { clearOfflineCaches } from "@/lib/clearOfflineCaches";
import { countQueuedWrites } from "@/lib/offlineQueue";

// Clears the offline page cache first (it holds this user's rendered pages),
// then runs the real server-side sign-out, which redirects to /login.
//
// The offline write queue (IndexedDB) is deliberately NOT cleared: it is
// tagged per user and only replays under the same user's session, so the
// changes wait for this user's next sign-in on this device. Because they are
// not synced yet, sign-out asks first when any are pending.
export function LogoutButton({ signOutAction }: { signOutAction: () => Promise<void> }) {
  return (
    <form
      action={async () => {
        let pending = 0;
        try {
          pending = (await countQueuedWrites()).mine;
        } catch {
          // Never block logout on the queue check.
        }
        if (
          pending > 0 &&
          !window.confirm(
            `You have ${pending} offline change${pending > 1 ? "s" : ""} that ${pending > 1 ? "have" : "has"} not synced yet. ` +
              "They will stay on this device and sync the next time you sign in here. Sign out anyway?"
          )
        ) {
          return;
        }
        await clearOfflineCaches();
        await signOutAction();
      }}
    >
      <button
        type="submit"
        className="w-full rounded-md border border-line px-3 py-1.5 text-xs text-ink-soft hover:bg-surface-2 transition"
      >
        Logout
      </button>
    </form>
  );
}
