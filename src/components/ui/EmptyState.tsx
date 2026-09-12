/**
 * Shared "no records yet" state — an icon in a soft circle, a heading,
 * one line of context, and an optional call-to-action. Replaces the old
 * plain-gray-text empty rows across every list page.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className = "",
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center gap-2 px-6 py-12 text-center ${className}`}>
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent-ink">{icon}</div>
      <p className="mt-1 text-sm font-semibold text-ink">{title}</p>
      {description && <p className="max-w-xs text-xs text-ink-soft">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
