"use client";

import { useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";

export type ThemeChoice = "light" | "dark" | "system";
export const THEME_STORAGE_KEY = "hitech-theme";

function applyTheme(choice: ThemeChoice) {
  if (choice === "system") {
    document.documentElement.removeAttribute("data-theme");
    localStorage.removeItem(THEME_STORAGE_KEY);
  } else {
    document.documentElement.setAttribute("data-theme", choice);
    localStorage.setItem(THEME_STORAGE_KEY, choice);
  }
}

const OPTIONS: { key: ThemeChoice; label: string; icon: React.ReactNode }[] = [
  { key: "light", label: "Light", icon: <Sun size={12} /> },
  { key: "dark", label: "Dark", icon: <Moon size={12} /> },
  { key: "system", label: "Auto", icon: <Monitor size={12} /> },
];

/** Light/Dark/System segmented control — wired to `data-theme` on <html> + localStorage. See THEME_INIT_SCRIPT in layout.tsx for the anti-flash inline script that applies the stored choice before first paint. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [choice, setChoice] = useState<ThemeChoice>(() => {
    if (typeof window === "undefined") return "system";
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  });

  function select(next: ThemeChoice) {
    setChoice(next);
    applyTheme(next);
  }

  return (
    <div className={`flex gap-0.5 rounded-lg bg-surface-2 p-0.5 ${className}`}>
      {OPTIONS.map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => select(opt.key)}
          aria-pressed={choice === opt.key}
          className={`flex flex-1 items-center justify-center gap-1 rounded-md py-1.5 text-[11px] font-medium transition ${
            choice === opt.key ? "bg-surface text-ink shadow-sm" : "text-ink-faint hover:text-ink-soft"
          }`}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}
