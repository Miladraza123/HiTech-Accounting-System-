"use client";

import { usePathname } from "next/navigation";

/**
 * Wraps the app shell's routed content so moving between pages gets a
 * brief, deliberate fade instead of an instant swap — purely cosmetic,
 * no effect on data loading or any route's own behavior. Keyed by
 * pathname so React remounts this div (restarting the CSS animation,
 * see .page-fade in globals.css) on a real navigation, not on a
 * same-page re-render.
 */
export function PageFadeTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="page-fade">
      {children}
    </div>
  );
}
