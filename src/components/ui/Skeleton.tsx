/** A single shimmering placeholder block — the building block for every loading skeleton in the app. */
export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`animate-pulse rounded bg-surface-2 ${className}`} style={style} />;
}

/** Skeleton for a list page: title bar + a table-shaped block of shimmering rows. */
export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden">
      <div className="border-b border-line bg-surface-2 px-4 py-2.5">
        <Skeleton className="h-3 w-24" />
      </div>
      <div className="divide-y divide-line">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-6 px-4 py-3">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton key={c} className="h-3" style={{ width: c === 0 ? "90px" : `${60 + ((r + c) % 4) * 20}px` }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Skeleton for a row of KPI cards, e.g. the Owner Dashboard. */
export function KpiGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-line bg-surface p-4 space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-5 w-20" />
        </div>
      ))}
    </div>
  );
}
