import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useProjectStore } from "@/state/projectStore";
import type { ExecutionSummary, DashboardAnalytics } from "@shared/ipcApi";
import { BarChart, type BarDatum } from "@/components/charts/BarChart";
import { StackedTrendChart } from "@/components/charts/StackedTrendChart";
import { chartColors, FAILURE_CLASSIFICATION_LABELS } from "@/components/charts/colors";

const SUITE_ORDER = ["bvt", "smoke", "sanity", "regression"];

export default function DashboardPage() {
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const currentProject = useProjectStore((s) => s.currentProject());
  const environments = useProjectStore((s) => s.environments);
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);
  const [executions, setExecutions] = useState<ExecutionSummary[]>([]);

  useEffect(() => {
    if (!currentProjectId) {
      setAnalytics(null);
      setExecutions([]);
      return;
    }
    void window.studio.analytics.dashboard(currentProjectId).then((r) => r.ok && setAnalytics(r.data));
    void window.studio.execution.list(currentProjectId).then((r) => r.ok && setExecutions(r.data));
  }, [currentProjectId]);

  if (!currentProjectId) {
    return (
      <div className="card">
        <h2>Welcome to Automation AI Studio</h2>
        <p className="muted">
          Select a project from the top bar, or <Link to="/projects">create your first project</Link> to get started.
        </p>
      </div>
    );
  }

  if (!analytics) return <p className="muted">Loading…</p>;

  const coverage = analytics.totalTestCases > 0 ? Math.round((analytics.automatedTestCases / analytics.totalTestCases) * 100) : 0;
  const lastExecution = executions[0];

  const suiteData: BarDatum[] = SUITE_ORDER.filter((s) => analytics.suiteCounts[s]).map((s) => ({
    label: s.toUpperCase(),
    value: analytics.suiteCounts[s],
  }));
  const otherSuites = Object.entries(analytics.suiteCounts).filter(([k]) => !SUITE_ORDER.includes(k));
  for (const [label, value] of otherSuites) suiteData.push({ label, value });

  const failureData: BarDatum[] = Object.entries(analytics.failureClassificationCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([cls, count]) => ({
      label: FAILURE_CLASSIFICATION_LABELS[cls] ?? cls,
      value: count,
      color: chartColors.status.critical,
    }));

  return (
    <div className="stack">
      <h1>{currentProject?.name}</h1>
      <div className="row wrap">
        <StatCard label="Total Test Cases" value={analytics.totalTestCases} />
        <StatCard label="Automated" value={analytics.automatedTestCases} />
        <StatCard label="Automation Coverage" value={`${coverage}%`} />
        <StatCard
          label="Pass Rate (last 10 runs)"
          value={analytics.overallPassRate === null ? "—" : `${analytics.overallPassRate}%`}
          tone={analytics.overallPassRate === null ? undefined : analytics.overallPassRate >= 80 ? "good" : analytics.overallPassRate >= 50 ? "warning" : "critical"}
        />
      </div>

      <div className="row wrap" style={{ alignItems: "stretch" }}>
        <div className="card" style={{ flex: 2, minWidth: 380 }}>
          <h2>Execution Trend</h2>
          <p className="muted" style={{ marginTop: -8, marginBottom: 14, fontSize: 12.5 }}>
            Pass / fail / skip for the last {analytics.recentExecutions.length || 0} execution(s), oldest to newest.
          </p>
          <StackedTrendChart points={analytics.recentExecutions} />
        </div>
        <div className="card" style={{ flex: 1, minWidth: 260 }}>
          <h2>Tests by Suite</h2>
          <p className="muted" style={{ marginTop: -8, marginBottom: 14, fontSize: 12.5 }}>
            A test can belong to more than one suite, so counts can overlap.
          </p>
          <BarChart data={suiteData} emptyLabel="No suite tags assigned yet." />
        </div>
      </div>

      {failureData.length > 0 && (
        <div className="card">
          <h2>Failure Reasons</h2>
          <p className="muted" style={{ marginTop: -8, marginBottom: 14, fontSize: 12.5 }}>
            Suggested classification across the last {analytics.recentExecutions.length} execution(s) — always a
            starting point to investigate, not a final verdict.
          </p>
          <BarChart data={failureData} />
        </div>
      )}

      <div className="card">
        <h2>Recent Executions</h2>
        {executions.length === 0 ? (
          <p className="muted">No executions yet. Run a test from the Execution page.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Trigger</th>
                <th>Environment</th>
                <th>Status</th>
                <th>Passed / Total</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {executions.slice(0, 8).map((e) => (
                <tr key={e.id} className="clickable" onClick={() => (window.location.hash = `#/reports/${e.id}`)}>
                  <td>{e.triggerType.toUpperCase()}</td>
                  <td>{environments.find((env) => env.id === e.environmentId)?.name ?? "—"}</td>
                  <td>
                    <span className={`badge ${e.status}`}>{e.status}</span>
                  </td>
                  <td>
                    {e.passed}/{e.totalTests}
                  </td>
                  <td className="muted">{new Date(e.startedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {lastExecution && (
        <p className="muted" style={{ fontSize: 12 }}>
          Last run: <Link to={`/reports/${lastExecution.id}`}>{lastExecution.triggerType.toUpperCase()} — {new Date(lastExecution.startedAt).toLocaleString()}</Link>
        </p>
      )}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string | number; tone?: "good" | "warning" | "critical" }) {
  const color = tone === "good" ? chartColors.status.good : tone === "warning" ? "#b45309" : tone === "critical" ? chartColors.status.critical : undefined;
  return (
    <div className="card" style={{ minWidth: 180, flex: 1 }}>
      <div className="muted" style={{ fontSize: 12, textTransform: "uppercase", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}
