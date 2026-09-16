"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CompanyLogo } from "@/components/CompanyLogo";
import { NavLink, type NavCategory } from "@/components/SidebarNav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { InstallAppButton } from "@/components/InstallAppButton";
import { NotificationBell } from "@/components/NotificationBell";
import type { NotificationItem } from "@/lib/notifications";

export function MobileNav({
  categories,
  userFullName,
  userRoleLabel,
  signOutAction,
  notifications,
  hasCompanyLogo,
}: {
  categories: NavCategory[];
  userFullName: string;
  userRoleLabel: string;
  signOutAction: () => Promise<void>;
  hasCompanyLogo: boolean;
  notifications: NotificationItem[];
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      {/* Mobile-only top bar — the desktop <aside> sidebar is hidden below the md breakpoint,
          so this is the only way to navigate on a phone. */}
      <div className="md:hidden sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <CompanyLogo hasLogo={hasCompanyLogo} width={118} fallbackSize={28} alt="HITECH ENGINEERING" />
          {!hasCompanyLogo && <span className="font-semibold text-ink text-sm">HiTech ERP</span>}
        </div>
        <div className="flex items-center gap-1">
          <NotificationBell notifications={notifications} />
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="rounded-md border border-line-strong p-2 text-ink-soft hover:bg-surface-2 transition"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <line x1="1" y1="4" x2="17" y2="4" />
              <line x1="1" y1="9" x2="17" y2="9" />
              <line x1="1" y1="14" x2="17" y2="14" />
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <div className="md:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85%] bg-surface border-r border-line flex flex-col overflow-y-auto">
            <div className="px-5 py-5 border-b border-line flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <CompanyLogo hasLogo={hasCompanyLogo} width={140} alt="HITECH ENGINEERING" />
                {!hasCompanyLogo && <span className="font-semibold text-ink text-sm">HiTech ERP</span>}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="rounded-md p-1.5 text-ink-faint hover:bg-surface-2 hover:text-ink transition"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <line x1="2" y1="2" x2="14" y2="14" />
                  <line x1="14" y1="2" x2="2" y2="14" />
                </svg>
              </button>
            </div>

            <form action="/search" className="px-3 pt-3" onSubmit={() => setOpen(false)}>
              <input
                type="text"
                name="q"
                placeholder="Search… (Query, SO, Invoice, Item…)"
                className="w-full rounded-md border border-line bg-bg px-3 py-1.5 text-xs text-ink outline-none focus:border-accent"
              />
            </form>

            <nav className="flex-1 px-3 py-3 space-y-0.5">
              {categories.map((cat) => {
                const visible = cat.items.filter((n) => n.show);
                if (visible.length === 0) return null;
                return (
                  <div key={cat.label || "_root"}>
                    {cat.label && (
                      <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{cat.label}</div>
                    )}
                    {visible.map((n) => (
                      <NavLink
                        key={n.href}
                        item={n}
                        active={pathname === n.href || (n.href !== "/" && pathname.startsWith(n.href + "/"))}
                        onClick={() => setOpen(false)}
                      />
                    ))}
                  </div>
                );
              })}
            </nav>

            <div className="border-t border-line px-3 py-4 space-y-3">
              <ThemeToggle />
              <InstallAppButton />
              <div className="px-2">
                <p className="text-sm text-ink truncate">{userFullName}</p>
                <p className="text-[11px] text-ink-faint truncate">{userRoleLabel}</p>
                <Link href="/account" onClick={() => setOpen(false)} className="text-[11px] text-accent-ink underline underline-offset-2">
                  Change Password
                </Link>
              </div>
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="w-full rounded-md border border-line px-3 py-1.5 text-xs text-ink-soft hover:bg-surface-2 transition"
                >
                  Logout
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
