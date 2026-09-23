import { chartColors } from "./colors";

export interface PieDatum {
  key: string;
  label: string;
  value: number;
  color: string;
}

/**
 * Part-to-whole donut chart — status colors for pass/fail/skip (or any
 * fixed, reserved palette passed in), a 2px surface gap between segments
 * (same "gap between fills" mark spec as the stacked trend/status bar
 * charts), and the total centered in the ring since a donut's hole is
 * otherwise dead space. Rendered at a fixed intrinsic pixel size — never
 * stretched to fill a wide container — so it stays a small, readable
 * accent rather than dominating the page.
 */
export function PieChart({
  data,
  size = 140,
  thickness = 22,
  emptyLabel = "No data yet",
  centerLabel,
}: {
  data: PieDatum[];
  size?: number;
  thickness?: number;
  emptyLabel?: string;
  centerLabel?: string;
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const nonZero = data.filter((d) => d.value > 0);

  if (total === 0 || nonZero.length === 0) {
    return <p className="muted" style={{ fontSize: 13 }}>{emptyLabel}</p>;
  }

  const cx = size / 2;
  const cy = size / 2;
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  const gapAngleDeg = nonZero.length > 1 ? 2.5 : 0; // small angular gap between segments, none for a single 100% segment
  const gapLength = (gapAngleDeg / 360) * circumference;

  let cursor = 0; // in circumference units, starting at 12 o'clock via the -90deg rotation below

  return (
    <div className="row" style={{ gap: 20, alignItems: "center" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Pass/fail/skip breakdown">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={chartColors.gridline} strokeWidth={thickness} opacity={0.4} />
        <g transform={`rotate(-90 ${cx} ${cy})`}>
          {nonZero.map((d) => {
            const segLength = Math.max(0, (d.value / total) * circumference - gapLength);
            const dashArray = `${segLength} ${circumference - segLength}`;
            const dashOffset = -cursor;
            cursor += (d.value / total) * circumference;
            return (
              <circle
                key={d.key}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={d.color}
                strokeWidth={thickness}
                strokeDasharray={dashArray}
                strokeDashoffset={dashOffset}
                strokeLinecap={nonZero.length > 1 ? "butt" : "round"}
              >
                <title>{`${d.label}: ${d.value} (${Math.round((d.value / total) * 100)}%)`}</title>
              </circle>
            );
          })}
        </g>
        <text x={cx} y={cy - 3} textAnchor="middle" fontSize="20" fontWeight={700} fill={chartColors.textPrimary}>
          {centerLabel ?? total}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="10.5" fill={chartColors.textMuted}>
          {centerLabel ? "" : "total"}
        </text>
      </svg>
      <div className="stack" style={{ gap: 6 }}>
        {nonZero.map((d) => (
          <span key={d.key} className="row" style={{ gap: 6, fontSize: 12.5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: d.color, display: "inline-block", flexShrink: 0 }} />
            <strong>{d.value}</strong>
            <span className="muted">
              {d.label} ({Math.round((d.value / total) * 100)}%)
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
