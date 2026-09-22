import { chartColors } from "./colors";

export interface BarDatum {
  label: string;
  value: number;
  color?: string;
}

/**
 * Horizontal magnitude-comparison bar chart — one hue by default (sequential
 * job, per the dataviz skill's form guidance), thin bars with a rounded
 * data-end, value labeled at the tip. A native <title> gives every bar an
 * exact-value hover tooltip without custom positioning machinery.
 */
export function BarChart({ data, emptyLabel = "No data yet" }: { data: BarDatum[]; emptyLabel?: string }) {
  if (data.length === 0) {
    return <p className="muted" style={{ fontSize: 13 }}>{emptyLabel}</p>;
  }

  const max = Math.max(1, ...data.map((d) => d.value));
  const rowHeight = 30;
  const barHeight = 16;
  const labelWidth = 110;
  const valueWidth = 40;
  const chartWidth = 320;
  const height = data.length * rowHeight;

  return (
    <svg width="100%" viewBox={`0 0 ${labelWidth + chartWidth + valueWidth} ${height}`} role="img" aria-label="Bar chart">
      {data.map((d, i) => {
        const y = i * rowHeight + (rowHeight - barHeight) / 2;
        const barWidth = Math.max(2, (d.value / max) * chartWidth);
        const color = d.color ?? chartColors.sequentialBlue;
        return (
          <g key={d.label}>
            <title>{`${d.label}: ${d.value}`}</title>
            <text
              x={labelWidth - 10}
              y={y + barHeight / 2}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="12"
              fill={chartColors.textSecondary}
            >
              {d.label}
            </text>
            <rect x={labelWidth} y={y} width={chartWidth} height={barHeight} fill={chartColors.gridline} opacity={0.35} rx={4} />
            <rect x={labelWidth} y={y} width={barWidth} height={barHeight} fill={color} rx={4} />
            <text
              x={labelWidth + barWidth + 8}
              y={y + barHeight / 2}
              dominantBaseline="middle"
              fontSize="12"
              fontWeight={700}
              fill={chartColors.textPrimary}
            >
              {d.value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
