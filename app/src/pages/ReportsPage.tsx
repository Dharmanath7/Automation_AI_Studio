import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useProjectStore } from "@/state/projectStore";
import type { ExecutionSummary, ExecutionDetail } from "@shared/ipcApi";

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
  const [executions, setExecutions] = useState<ExecutionSummary[]>([]);

  useEffect(() => {
    if (!currentProjectId) return;
    void window.studio.execution.list(currentProjectId).then((r) => r.ok && setExecutions(r.data));
  }, [currentProjectId]);

  if (!currentProjectId) return <p className="muted">Select a project first.</p>;

  return (
    <div className="stack">
      <h1>Execution History</h1>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Trigger</th>
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
                <td colSpan={7} className="muted">
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
  const [detail, setDetail] = useState<ExecutionDetail | null>(null);
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);

  useEffect(() => {
    void window.studio.execution.get(executionId).then((r) => {
      if (r.ok) setDetail(r.data);
    });
  }, [executionId]);

  if (!detail) return <p className="muted">Loading…</p>;
  const selectedTest = detail.tests.find((t) => t.id === selectedTestId) ?? detail.tests.find((t) => t.status !== "passed");

  return (
    <div className="stack">
      <h1>
        Execution — {detail.triggerType.toUpperCase()} <span className={`badge ${detail.status}`}>{detail.status}</span>
      </h1>
      <div className="row wrap muted" style={{ fontSize: 13 }}>
        <span>Build: {detail.buildId ?? "—"}</span>
        <span>Mode: {detail.mode}</span>
        <span>Started: {new Date(detail.startedAt).toLocaleString()}</span>
        <span>Duration: {detail.durationMs ? `${(detail.durationMs / 1000).toFixed(1)}s` : "—"}</span>
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
                  <td className="mono">{t.testCaseId ?? "(unmatched)"}</td>
                  <td>
                    <span className={`badge ${t.status}`}>{t.status}</span>
                  </td>
                  <td className="muted">{t.failureClassification ?? "—"}</td>
                  <td className="muted">{(t.durationMs / 1000).toFixed(2)}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selectedTest && selectedTest.status !== "passed" && (
          <div className="card" style={{ flex: 1 }}>
            <h3>Failure Detail</h3>
            <p>
              <span className={`badge ${selectedTest.failureClassification ?? "neutral"}`}>
                {selectedTest.failureClassification ?? "unknown"}
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
