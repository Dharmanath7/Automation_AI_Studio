import { chartColors } from "./colors";
import type { ExecutionTrendPoint } from "@shared/ipcApi";

const SEGMENTS: { key: "passed" | "failed" | "skipped"; label: string; color: string }[] = [
  { key: "passed", label: "Passed", color: chartColors.status.good },
  { key: "failed", label: "Failed", color: chartColors.status.critical },
  { key: "skipped", label: "Skipped", color: chartColors.status.neutral },
];

function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** A rect path rounded only at the top two corners — square at the baseline, per the mark spec. */
function topRoundedRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, Math.max(h, 0));
  if (rr <= 0) return `M${x},${y} h${w} v${h} h${-w} Z`;
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

/**
 * Part-to-whole (pass/fail/skip) per execution, trend over time — a stacked
 * column per execution, oldest to newest left-to-right. Status colors (not
 * categorical) since passed/failed/skipped are states, not identities.
 */
export function StackedTrendChart({ points }: { points: ExecutionTrendPoint[] }) {
  if (points.length === 0) {
    return <p className="muted" style={{ fontSize: 13 }}>No executions yet — run a test to see the trend here.</p>;
  }

  const maxTotal = Math.max(1, ...points.map((p) => p.total));
  const plotHeight = 140;
  const barWidth = 22;
  const gap = 14;
  const chartWidth = points.length * (barWidth + gap) + gap;
  const totalHeight = plotHeight + 26; // plot + axis label band
  const segmentGap = 2;

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${chartWidth} ${totalHeight}`} role="img" aria-label="Executions pass/fail trend">
        <line x1={0} y1={plotHeight} x2={chartWidth} y2={plotHeight} stroke={chartColors.baseline} strokeWidth={1} />
        {points.map((p, i) => {
          const x = gap + i * (barWidth + gap);
          const scale = plotHeight / maxTotal;
          const stackHeight = p.total * scale;
          const stackTopY = plotHeight - stackHeight;

          let cursorY = plotHeight;
          const segs = SEGMENTS.map((s) => ({ ...s, count: p[s.key] }));
          const nonZeroCount = segs.filter((s) => s.count > 0).length;

          // Plain square rects for each segment, clipped as a group to a
          // path that's rounded only at the top — the mark spec's "4px
          // rounded data-end, square at the baseline" for a stack, not a
          // per-segment rx which would (wrongly) round every segment's
          // corners, including the ones sitting on the baseline.
          const rects = segs.map((s) => {
            if (s.count <= 0) return null;
            const rawHeight = s.count * scale;
            const h = Math.max(1, rawHeight - (nonZeroCount > 1 ? segmentGap : 0));
            const y = cursorY - rawHeight;
            cursorY -= rawHeight;
            return <rect key={s.key} x={x} y={y} width={barWidth} height={h} fill={s.color} />;
          });

          const clipId = `trend-cap-${p.id}`;
          return (
            <g key={p.id}>
              <title>{`${new Date(p.startedAt).toLocaleString()} (${p.triggerType}): ${p.passed} passed, ${p.failed} failed${p.skipped ? `, ${p.skipped} skipped` : ""} of ${p.total}`}</title>
              {p.total > 0 && (
                <>
                  <clipPath id={clipId}>
                    <path d={topRoundedRectPath(x, stackTopY, barWidth, stackHeight, 4)} />
                  </clipPath>
                  <g clipPath={`url(#${clipId})`}>{rects}</g>
                </>
              )}
              {p.total > 0 && (
                <text x={x + barWidth / 2} y={stackTopY - 6} textAnchor="middle" fontSize="11" fontWeight={700} fill={chartColors.textPrimary}>
                  {p.total}
                </text>
              )}
              <text x={x + barWidth / 2} y={plotHeight + 16} textAnchor="middle" fontSize="10" fill={chartColors.textMuted}>
                {shortDate(p.startedAt)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="row" style={{ gap: 16, marginTop: 4 }}>
        {SEGMENTS.map((s) => (
          <span key={s.key} className="row" style={{ gap: 6, fontSize: 12 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, display: "inline-block" }} />
            <span className="muted">{s.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
