import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useProjectStore } from "@/state/projectStore";
import type { TestCase, ExecutionSummary } from "@shared/ipcApi";

export default function DashboardPage() {
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const currentProject = useProjectStore((s) => s.currentProject());
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [executions, setExecutions] = useState<ExecutionSummary[]>([]);

  useEffect(() => {
    if (!currentProjectId) {
      setTestCases([]);
      setExecutions([]);
      return;
    }
    void window.studio.testCases.list(currentProjectId).then((r) => r.ok && setTestCases(r.data));
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

  const automated = testCases.filter((t) => t.automationStatus === "automated").length;
  const coverage = testCases.length > 0 ? Math.round((automated / testCases.length) * 100) : 0;
  const lastExecution = executions[0];

  return (
    <div className="stack">
      <h1>{currentProject?.name}</h1>
      <div className="row wrap">
        <StatCard label="Total Test Cases" value={testCases.length} />
        <StatCard label="Automated" value={automated} />
        <StatCard label="Automation Coverage" value={`${coverage}%`} />
        <StatCard
          label="Last Execution"
          value={lastExecution ? `${lastExecution.passed}/${lastExecution.totalTests} passed` : "—"}
        />
      </div>

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
                  <td>{e.triggerType}</td>
                  <td className="mono">{e.environmentId.slice(0, 8)}</td>
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
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card" style={{ minWidth: 180, flex: 1 }}>
      <div className="muted" style={{ fontSize: 12, textTransform: "uppercase", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
