import { useEffect, useState } from "react";
import { useProjectStore } from "@/state/projectStore";
import type { RuntimeCheckResult } from "@shared/ipcApi";

export default function RuntimePage() {
  const currentProject = useProjectStore((s) => s.currentProject());
  const [results, setResults] = useState<RuntimeCheckResult[]>([]);
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    void window.studio.runtime.lastCheck().then((r) => r.ok && setResults(r.data));
  }, []);

  async function runCheck() {
    if (!currentProject) return;
    setIsChecking(true);
    const res = await window.studio.runtime.check(currentProject.id);
    setIsChecking(false);
    if (res.ok) setResults(res.data);
  }

  if (!currentProject) return <p className="muted">Select a project first.</p>;

  return (
    <div className="stack">
      <div className="row">
        <h1>Runtime Manager</h1>
        <div className="spacer" />
        <button className="primary" onClick={() => void runCheck()} disabled={isChecking}>
          {isChecking ? "Checking…" : "Check Runtime"}
        </button>
      </div>
      <p className="muted">Verifies the Python/Playwright/Pytest toolchain is installed in the project's directory (or its .venv).</p>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Tool</th>
              <th>Status</th>
              <th>Version / Details</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.tool}>
                <td>{r.tool}</td>
                <td>
                  <span className={`badge ${r.installed ? "passed" : "failed"}`}>{r.installed ? "Installed" : "Missing"}</span>
                </td>
                <td className="mono muted">{r.version ?? r.details ?? "—"}</td>
              </tr>
            ))}
            {results.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  No checks run yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
