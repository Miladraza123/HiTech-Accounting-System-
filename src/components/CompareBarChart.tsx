// Simple horizontal comparison bars (e.g. Receivables vs Payables) — plain
// divs rather than SVG, since a meter-style bar needs no real charting math
// and this stays trivially responsive down to phone width. Matches the
// app's existing "surface-2 track" visual language (progress-bar-like).
export type CompareBar = { key: string; label: string; value: number; color: string };

export function CompareBarChart({
  bars,
  valueFormatter = (n: number) => n.toLocaleString(),
}: {
  bars: CompareBar[];
  valueFormatter?: (n: number) => string;
}) {
  const maxVal = Math.max(1, ...bars.map((b) => Math.abs(b.value)));

  return (
    <div className="space-y-3">
      {bars.map((b) => (
        <div key={b.key}>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-ink-soft">{b.label}</span>
            <span className="tabular font-medium text-ink">{valueFormatter(b.value)}</span>
          </div>
          <div className="h-2.5 rounded-full bg-surface-2 overflow-hidden">
            <div
              className="h-full rounded-full transition-[width]"
              style={{ width: `${Math.min(100, (Math.abs(b.value) / maxVal) * 100)}%`, background: b.color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
