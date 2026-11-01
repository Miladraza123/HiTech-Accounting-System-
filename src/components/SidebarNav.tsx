"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export type NavItem = { href: string; label: string; show: boolean; badge?: number; icon?: ReactNode };
export type NavCategory = { label: string; items: NavItem[] };

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

const STORAGE_KEY = "nav-open-groups";

const CHANGE_EVENT = "nav-open-groups-change";

/** Raw stored JSON string ("[]" when missing/blocked) — a string so useSyncExternalStore can compare snapshots by value. */
function readRaw(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "[]";
  } catch {
    return "[]"; // private window / blocked storage: the menu still works, it just forgets
  }
}

function parseLabels(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function writeLabels(labels: string[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(labels));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Grouped navigation where each category heading is a collapsible section.
 * The group holding the current page is always open (so you can see where you
 * are); other groups start closed and remember how the user left them. A closed
 * group still shows the total of its items' badges so no alert is hidden.
 */
export function NavGroups({ categories, pathname, onNavigate }: { categories: NavCategory[]; pathname: string; onNavigate?: () => void }) {
  const activeLabel = categories.find((c) => c.label && c.items.some((n) => n.show && isActive(pathname, n.href)))?.label;
  // The server snapshot is "[]" (only the active group open), so hydration matches;
  // the stored choices then apply on the client without a setState-in-effect.
  const openLabels = parseLabels(useSyncExternalStore(subscribe, readRaw, () => "[]"));

  function toggle(label: string) {
    writeLabels(openLabels.includes(label) ? openLabels.filter((l) => l !== label) : [...openLabels, label]);
  }

  return (
    <>
      {categories.map((cat) => {
        const visible = cat.items.filter((n) => n.show);
        if (visible.length === 0) return null;
        if (!cat.label) {
          return (
            <div key="_root">
              {visible.map((n) => (
                <NavLink key={n.href} item={n} active={isActive(pathname, n.href)} onClick={onNavigate} />
              ))}
            </div>
          );
        }
        const isOpen = cat.label === activeLabel || openLabels.includes(cat.label);
        const badgeTotal = visible.reduce((sum, n) => sum + (n.badge ?? 0), 0);
        const panelId = `nav-group-${cat.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
        return (
          <div key={cat.label}>
            <button
              type="button"
              onClick={() => toggle(cat.label)}
              aria-expanded={isOpen}
              aria-controls={panelId}
              className="mt-1 flex w-full items-center gap-1.5 rounded-md px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint hover:bg-surface-2 hover:text-ink transition"
            >
              {isOpen ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
              <span className="flex-1 truncate">{cat.label}</span>
              {!isOpen && badgeTotal > 0 && (
                <span className="rounded-full bg-bad px-1.5 py-0.5 text-[10px] font-mono text-white leading-none">{badgeTotal}</span>
              )}
            </button>
            {isOpen && (
              <div id={panelId} className="space-y-0.5">
                {visible.map((n) => (
                  <NavLink key={n.href} item={n} active={isActive(pathname, n.href)} onClick={onNavigate} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/** Desktop sidebar nav — collapsible groups, current-page highlighted with an accent left border + tint. */
export function SidebarNav({ categories }: { categories: NavCategory[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
      <NavGroups categories={categories} pathname={pathname} />
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
