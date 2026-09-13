"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, ListChecks, Landmark, Boxes } from "lucide-react";
import type { NotificationItem } from "@/lib/notifications";

const TYPE_ICON: Record<NotificationItem["type"], React.ReactNode> = {
  task_due: <ListChecks size={13} />,
  credit_limit: <Landmark size={13} />,
  low_stock: <Boxes size={13} />,
};

const TYPE_LABEL: Record<NotificationItem["type"], string> = {
  task_due: "Tasks due",
  credit_limit: "Credit limit",
  low_stock: "Low stock",
};

/**
 * Icon-button + dropdown, used in both the desktop sidebar and the mobile
 * top bar. Notifications are computed server-side (see
 * src/lib/notifications.ts) and passed in as a plain prop — this
 * component only handles showing them.
 *
 * `align` controls which side the panel opens from: the desktop sidebar
 * is only 256px wide, so a `right-0` panel anchored to the bell's own
 * small wrapper (near the sidebar's left side) would overflow past the
 * left edge of the whole page and get clipped — pass `align="left"`
 * there so it opens rightward into the main content area instead. The
 * mobile top bar's bell sits near the right edge of the screen, where
 * `right-0` (the default) is correct.
 */
export function NotificationBell({ notifications, align = "right" }: { notifications: NotificationItem[]; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const hasUrgent = notifications.some((n) => n.tone === "bad");
  const grouped: NotificationItem["type"][] = ["task_due", "credit_limit", "low_stock"];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        className="relative rounded-md p-1.5 text-ink-soft hover:bg-surface-2 hover:text-ink transition"
      >
        <Bell size={17} />
        {notifications.length > 0 && (
          <span
            className={`absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-mono font-medium text-white ${
              hasUrgent ? "bg-bad" : "bg-warn"
            }`}
          >
            {notifications.length > 9 ? "9+" : notifications.length}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`absolute ${align === "left" ? "left-0" : "right-0"} z-50 mt-2 w-80 max-w-[90vw] rounded-xl border border-line bg-surface shadow-lg overflow-hidden`}
        >
          <div className="px-4 py-2.5 border-b border-line">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Notifications</p>
          </div>
          <div className="max-h-96 overflow-y-auto divide-y divide-line">
            {notifications.length === 0 && <p className="px-4 py-6 text-center text-sm text-ink-faint">Nothing needs your attention right now.</p>}
            {grouped.map((type) => {
              const items = notifications.filter((n) => n.type === type);
              if (!items.length) return null;
              return (
                <div key={type}>
                  <p className="px-4 pt-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint flex items-center gap-1.5">
                    {TYPE_ICON[type]} {TYPE_LABEL[type]}
                  </p>
                  {items.map((n) => (
                    <Link
                      key={n.id}
                      href={n.href}
                      onClick={() => setOpen(false)}
                      className="block px-4 py-2 hover:bg-surface-2 transition"
                    >
                      <span className="flex items-start gap-2">
                        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${n.tone === "bad" ? "bg-bad" : "bg-warn"}`} />
                        <span className="min-w-0">
                          <span className="block text-sm text-ink truncate">{n.title}</span>
                          <span className="block text-xs text-ink-faint">{n.description}</span>
                        </span>
                      </span>
                    </Link>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
