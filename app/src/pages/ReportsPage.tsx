import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useProjectStore } from "@/state/projectStore";
import type { ExecutionSummary, ExecutionDetail, TestCase } from "@shared/ipcApi";
import { StackedTrendChart } from "@/components/charts/StackedTrendChart";
import { StatusBar } from "@/components/charts/StatusBar";
import { FAILURE_CLASSIFICATION_LABELS } from "@/components/charts/colors";

// Looked up by artifact row id (server-resolved to the real file path in
// main.ts) rather than encoding the Windows file path into the URL — see
// the comment in electron/main.ts's aas-artifact protocol handler.
function artifactUrl(artifactId: string): string {
  return `aas-artifact://${artifactId}`;
}

export default function ReportsPage() {
  const { executionId } = useParams();
  if (executionId) return <ExecutionDetailView executionId={executionId} />;
  return <ExecutionListView />;
}

function ExecutionListView() {
  const navigate = useNavigate();
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const environments = useProjectStore((s) => s.environments);
  const [executions, setExecutions] = useState<ExecutionSummary[]>([]);

  useEffect(() => {
    if (!currentProjectId) return;
    void window.studio.execution.list(currentProjectId).then((r) => r.ok && setExecutions(r.data));
  }, [currentProjectId]);

  const trendPoints = useMemo(
    () =>
      [...executions]
        .slice(0, 10)
        .reverse()
        .map((e) => ({
          id: e.id,
          startedAt: e.startedAt,
          triggerType: e.triggerType,
          total: e.totalTests,
          passed: e.passed,
          failed: e.failed,
          skipped: e.skipped,
        })),
    [executions]
  );

  if (!currentProjectId) return <p className="muted">Select a project first.</p>;

  return (
    <div className="stack">
      <h1>Execution History</h1>

      {executions.length > 0 && (
        <div className="card">
          <h2>Trend</h2>
          <p className="muted" style={{ marginTop: -8, marginBottom: 14, fontSize: 12.5 }}>
            Last {trendPoints.length} execution(s), oldest to newest. Click a run below for full detail.
          </p>
          <StackedTrendChart points={trendPoints} />
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Trigger</th>
              <th>Environment</th>
              <th>Build</th>
              <th>Mode</th>
              <th>Status</th>
              <th>Passed / Total</th>
              <th>Started</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {executions.map((e) => (
              <tr key={e.id} className="clickable" onClick={() => navigate(`/reports/${e.id}`)}>
                <td>{e.triggerType.toUpperCase()}</td>
                <td>{environments.find((env) => env.id === e.environmentId)?.name ?? "—"}</td>
                <td className="muted">{e.buildId ?? "—"}</td>
                <td className="muted">{e.mode}</td>
                <td>
                  <span className={`badge ${e.status}`}>{e.status}</span>
                </td>
                <td>
                  {e.passed}/{e.totalTests}
                </td>
                <td className="muted">{new Date(e.startedAt).toLocaleString()}</td>
                <td className="muted">{e.durationMs ? `${(e.durationMs / 1000).toFixed(1)}s` : "—"}</td>
              </tr>
            ))}
            {executions.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  No executions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExecutionDetailView({ executionId }: { executionId: string }) {
  const environments = useProjectStore((s) => s.environments);
  const [detail, setDetail] = useState<ExecutionDetail | null>(null);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);

  useEffect(() => {
    void window.studio.execution.get(executionId).then((r) => {
      if (r.ok) setDetail(r.data);
    });
  }, [executionId]);

  useEffect(() => {
    if (detail) void window.studio.testCases.list(detail.projectId).then((r) => r.ok && setTestCases(r.data));
  }, [detail]);

  if (!detail) return <p className="muted">Loading…</p>;
  const selectedTest = detail.tests.find((t) => t.id === selectedTestId) ?? detail.tests.find((t) => t.status !== "passed");

  function testLabel(testCaseId: string | null): string {
    if (!testCaseId) return "(test case deleted)";
    const tc = testCases.find((t) => t.id === testCaseId);
    return tc ? `${tc.displayId} — ${tc.title}` : testCaseId;
  }

  return (
    <div className="stack">
      <h1>
        Execution — {detail.triggerType.toUpperCase()} <span className={`badge ${detail.status}`}>{detail.status}</span>
      </h1>
      <div className="row wrap muted" style={{ fontSize: 13 }}>
        <span>Environment: {environments.find((e) => e.id === detail.environmentId)?.name ?? "—"}</span>
        <span>Build: {detail.buildId ?? "—"}</span>
        <span>Mode: {detail.mode}</span>
        <span>Started: {new Date(detail.startedAt).toLocaleString()}</span>
        <span>Duration: {detail.durationMs ? `${(detail.durationMs / 1000).toFixed(1)}s` : "—"}</span>
      </div>

      <div className="card">
        <StatusBar passed={detail.passed} failed={detail.failed} skipped={detail.skipped} />
      </div>

      <div className="row" style={{ alignItems: "flex-start", gap: 16 }}>
        <div className="card" style={{ flex: 1, padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Test</th>
                <th>Status</th>
                <th>Classification</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {detail.tests.map((t) => (
                <tr key={t.id} className="clickable" onClick={() => setSelectedTestId(t.id)}>
                  <td>{testLabel(t.testCaseId)}</td>
                  <td>
                    <span className={`badge ${t.status}`}>{t.status}</span>
                  </td>
                  <td className="muted">{t.failureClassification ? FAILURE_CLASSIFICATION_LABELS[t.failureClassification] ?? t.failureClassification : "—"}</td>
                  <td className="muted">{(t.durationMs / 1000).toFixed(2)}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selectedTest && selectedTest.status !== "passed" && (
          <div className="card" style={{ flex: 1 }}>
            <h3>Failure Detail — {testLabel(selectedTest.testCaseId)}</h3>
            <p>
              <span className={`badge ${selectedTest.failureClassification ?? "neutral"}`}>
                {selectedTest.failureClassification ? FAILURE_CLASSIFICATION_LABELS[selectedTest.failureClassification] ?? selectedTest.failureClassification : "Unknown"}
              </span>{" "}
              <span className="muted">(suggested — confirm or correct manually in a future release)</span>
            </p>
            <pre
              className="mono"
              style={{ background: "#0f1117", color: "#f0b4b0", padding: 12, borderRadius: 6, maxHeight: 240, overflow: "auto", fontSize: 12 }}
            >
              {selectedTest.errorMessage ?? "(no error message captured)"}
            </pre>
            {selectedTest.artifacts
              .filter((a) => a.kind === "screenshot")
              .map((a) => (
                <div key={a.id} style={{ marginTop: 12 }}>
                  <div className="muted mono" style={{ fontSize: 11, marginBottom: 4 }}>
                    {a.filePath}
                  </div>
                  <img src={artifactUrl(a.id)} alt="Failure screenshot" style={{ maxWidth: "100%", border: "1px solid var(--color-border)", borderRadius: 6 }} />
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
