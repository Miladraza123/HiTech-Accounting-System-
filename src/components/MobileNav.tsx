"use client";

import { useState } from "react";
import Link from "next/link";

type NavItem = { href: string; label: string; show: boolean; badge?: number };

export function MobileNav({
  navItems,
  userFullName,
  userRoleLabel,
  signOutAction,
}: {
  navItems: NavItem[];
  userFullName: string;
  userRoleLabel: string;
  signOutAction: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile-only top bar — the desktop <aside> sidebar is hidden below the md breakpoint,
          so this is the only way to navigate on a phone. */}
      <div className="md:hidden sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-ledger text-ledger-soft font-mono text-xs font-semibold">
            H
          </div>
          <span className="font-semibold text-ink text-sm">HiTech ERP</span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Menu kholen"
          className="rounded-md border border-line-strong p-2 text-ink-soft hover:bg-surface-2 transition"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <line x1="1" y1="4" x2="17" y2="4" />
            <line x1="1" y1="9" x2="17" y2="9" />
            <line x1="1" y1="14" x2="17" y2="14" />
          </svg>
        </button>
      </div>

      {open && (
        <div className="md:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85%] bg-surface border-r border-line flex flex-col overflow-y-auto">
            <div className="px-5 py-5 border-b border-line flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-ledger text-ledger-soft font-mono text-sm font-semibold">
                  H
                </div>
                <span className="font-semibold text-ink text-sm">HiTech ERP</span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Menu band karen"
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

            <nav className="flex-1 px-3 py-4 space-y-0.5">
              {navItems
                .filter((n) => n.show)
                .map((n) => (
                  <Link
                    key={n.href}
                    href={n.href}
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-ink-soft hover:bg-surface-2 hover:text-ink transition"
                  >
                    <span>{n.label}</span>
                    {!!n.badge && (
                      <span className="rounded-full bg-bad px-1.5 py-0.5 text-[10px] font-mono text-white leading-none">{n.badge}</span>
                    )}
                  </Link>
                ))}
            </nav>

            <div className="border-t border-line px-3 py-4 space-y-2">
              <div className="px-2">
                <p className="text-sm text-ink truncate">{userFullName}</p>
                <p className="text-[11px] text-ink-faint truncate">{userRoleLabel}</p>
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
