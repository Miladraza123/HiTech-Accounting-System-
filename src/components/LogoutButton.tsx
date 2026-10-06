"use client";

import { clearOfflineCaches } from "@/lib/clearOfflineCaches";

// Clears the offline page cache first (it holds this user's rendered pages),
// then runs the real server-side sign-out, which redirects to /login.
export function LogoutButton({ signOutAction }: { signOutAction: () => Promise<void> }) {
  return (
    <form
      action={async () => {
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
