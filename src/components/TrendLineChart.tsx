// Theme-matching multi-line trend chart, hand-drawn as inline SVG — no
// charting library, so it costs nothing in bundle size and automatically
// follows the app's CSS custom properties (light/dark) since the colors are
// passed through as `var(--...)` strings resolved at paint time. Server
// component friendly: pure markup, no client JS/hooks, hover tooltips come
// from native SVG <title> elements on each point.
export type TrendSeries = { key: string; label: string; color: string; values: number[] };

export function TrendLineChart({
  labels,
  series,
  height = 180,
}: {
  labels: string[];
  series: TrendSeries[];
  height?: number;
}) {
  const hasData = series.some((s) => s.values.some((v) => v > 0));
  if (!labels.length || !hasData) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-line text-xs text-ink-faint" style={{ height }}>
        Is period mein trend data available nahi hai.
      </div>
    );
  }

  const width = 600;
  const padTop = 10;
  const padBottom = 24;
  const padLeft = 4;
  const padRight = 4;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const maxVal = Math.max(1, ...series.flatMap((s) => s.values));
  const n = labels.length;
  const xFor = (i: number) => padLeft + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yFor = (v: number) => padTop + plotH - (v / maxVal) * plotH;

  // Show at most ~8 x-axis labels so long ranges (weekly buckets) don't overlap.
  const labelStride = Math.max(1, Math.ceil(n / 8));

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
        <line x1={padLeft} y1={padTop + plotH} x2={width - padRight} y2={padTop + plotH} stroke="var(--line)" strokeWidth={1} />
        {series.map((s) => {
          const points = s.values.map((v, i) => `${xFor(i)},${yFor(v)}`).join(" ");
          return (
            <g key={s.key}>
              <polyline points={points} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {s.values.map((v, i) => (
                <circle key={i} cx={xFor(i)} cy={yFor(v)} r={2.5} fill={s.color}>
                  <title>
                    {s.label} — {labels[i]}: {v}
                  </title>
                </circle>
              ))}
            </g>
          );
        })}
        {labels.map((l, i) =>
          i % labelStride === 0 ? (
            <text key={i} x={xFor(i)} y={height - 6} fontSize={9} textAnchor="middle" fill="var(--ink-faint)" fontFamily="var(--font-mono)">
              {l}
            </text>
          ) : null
        )}
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {series.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5 text-xs text-ink-soft">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: s.color }} />
            {s.label}
          </div>
        ))}
      </div>
    </div>
  );
}
