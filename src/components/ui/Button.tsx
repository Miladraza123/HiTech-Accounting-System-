import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:opacity-90",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-surface-2",
  danger: "bg-bad text-white hover:opacity-90",
  ghost: "bg-transparent text-accent-ink hover:bg-accent-soft",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

/**
 * The shared button look as a plain Tailwind class string — apply it
 * directly to a `<Link>`/`<a>` when the action navigates (a real
 * `<button>` isn't appropriate there), or use the `<Button>` component
 * below for a real button. One source of truth for every "primary/
 * secondary/danger/ghost" button in the app instead of each page
 * hand-typing the same classes.
 */
export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className = ""): string {
  return [
    "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
    "disabled:opacity-45 disabled:pointer-events-none",
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={buttonClass(variant, size, className)} {...rest} />;
}
