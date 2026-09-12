"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export type NavItem = { href: string; label: string; show: boolean; badge?: number; icon?: ReactNode };
export type NavCategory = { label: string; items: NavItem[] };

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

/** Desktop sidebar nav — grouped into categories, current-page highlighted with an accent left border + tint. */
export function SidebarNav({ categories }: { categories: NavCategory[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
      {categories.map((cat) => {
        const visible = cat.items.filter((n) => n.show);
        if (visible.length === 0) return null;
        return (
          <div key={cat.label || "_root"}>
            {cat.label && <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{cat.label}</div>}
            {visible.map((n) => (
              <NavLink key={n.href} item={n} active={isActive(pathname, n.href)} onClick={undefined} />
            ))}
          </div>
        );
      })}
    </nav>
  );
}

export function NavLink({ item, active, onClick }: { item: NavItem; active: boolean; onClick?: () => void }) {
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={`flex items-center gap-2.5 rounded-md border-l-[3px] px-3 py-2 text-sm transition ${
        active ? "border-accent bg-accent-soft font-medium text-accent-ink" : "border-transparent text-ink-soft hover:bg-surface-2 hover:text-ink"
      }`}
    >
      {item.icon}
      <span className="flex-1 truncate">{item.label}</span>
      {!!item.badge && <span className="rounded-full bg-bad px-1.5 py-0.5 text-[10px] font-mono text-white leading-none">{item.badge}</span>}
    </Link>
  );
}
