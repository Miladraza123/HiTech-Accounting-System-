export function Card({
  children,
  className = "",
  padded = false,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return <div className={`rounded-xl border border-line bg-surface overflow-hidden ${padded ? "p-5" : ""} ${className}`}>{children}</div>;
}

export function CardHeader({ title, action }: { title: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-line px-4 py-3">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {action}
    </div>
  );
}
