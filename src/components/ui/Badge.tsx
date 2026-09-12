export type BadgeTone = "warn" | "good" | "bad" | "neutral" | "ledger" | "accent";

const TONE: Record<BadgeTone, { bg: string; text: string; dot: string }> = {
  warn: { bg: "bg-warn-soft", text: "text-warn", dot: "bg-warn" },
  good: { bg: "bg-good-soft", text: "text-good", dot: "bg-good" },
  bad: { bg: "bg-bad-soft", text: "text-bad", dot: "bg-bad" },
  neutral: { bg: "bg-surface-2", text: "text-ink-soft", dot: "bg-ink-faint" },
  ledger: { bg: "bg-ledger-soft", text: "text-ledger", dot: "bg-ledger" },
  accent: { bg: "bg-accent-soft", text: "text-accent-ink", dot: "bg-accent" },
};

/** Shared status pill — a colored tone plus a small dot, everywhere a document/record status shows in the app. */
export function Badge({
  tone = "neutral",
  dot = true,
  className = "",
  children,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const t = TONE[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-xs whitespace-nowrap ${t.bg} ${t.text} ${className}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />}
      {children}
    </span>
  );
}
