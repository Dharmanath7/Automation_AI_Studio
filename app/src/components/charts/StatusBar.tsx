import { chartColors } from "./colors";

const SEGMENTS: { key: "passed" | "failed" | "skipped"; label: string; color: string }[] = [
  { key: "passed", label: "Passed", color: chartColors.status.good },
  { key: "failed", label: "Failed", color: chartColors.status.critical },
  { key: "skipped", label: "Skipped", color: chartColors.status.neutral },
];

/** Single horizontal stacked bar for one execution's pass/fail/skip part-to-whole breakdown. */
export function StatusBar({ passed, failed, skipped }: { passed: number; failed: number; skipped: number }) {
  const total = passed + failed + skipped;
  const counts = { passed, failed, skipped };
  if (total === 0) return <p className="muted" style={{ fontSize: 13 }}>No tests in this execution.</p>;

  const nonZero = SEGMENTS.filter((s) => counts[s.key] > 0);
  let cursor = 0;

  return (
    <div>
      <svg width="100%" height="20" viewBox="0 0 1000 20" preserveAspectRatio="none" role="img" aria-label="Pass/fail/skip breakdown">
        {/* Both ends of the whole bar are "data ends" here (there's no
            baseline concept for a horizontal 0-100% bar), so a single clip
            over the whole group — rounded on all sides — is correct; only
            the individual segments inside must stay square where they
            touch a neighbor. */}
        <clipPath id="status-bar-cap">
          <rect x={0} y={0} width={1000} height={20} rx={4} />
        </clipPath>
        <g clipPath="url(#status-bar-cap)">
          {nonZero.map((s, i) => {
            const width = (counts[s.key] / total) * 1000;
            const isFirst = i === 0;
            const isLast = i === nonZero.length - 1;
            const gap = nonZero.length > 1 ? 2 : 0;
            const x = cursor + (isFirst ? 0 : gap);
            const w = Math.max(1, width - (isFirst || isLast ? gap / 2 : gap));
            cursor += width;
            return (
              <rect key={s.key} x={x} y={0} width={w} height={20} fill={s.color}>
                <title>{`${s.label}: ${counts[s.key]} (${Math.round((counts[s.key] / total) * 100)}%)`}</title>
              </rect>
            );
          })}
        </g>
      </svg>
      <div className="row wrap" style={{ gap: 16, marginTop: 8 }}>
        {SEGMENTS.filter((s) => counts[s.key] > 0).map((s) => (
          <span key={s.key} className="row" style={{ gap: 6, fontSize: 12.5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, display: "inline-block" }} />
            <strong>{counts[s.key]}</strong>
            <span className="muted">
              {s.label} ({Math.round((counts[s.key] / total) * 100)}%)
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
