import { useEffect, useMemo, useRef, useState } from "react";
import { useProjectStore } from "@/state/projectStore";
import type { TestCase, TriggerType } from "@shared/ipcApi";

const SUITES: TriggerType[] = ["bvt", "smoke", "sanity", "regression"];

export default function ExecutionPage() {
  const currentProject = useProjectStore((s) => s.currentProject());
  const currentEnvironmentId = useProjectStore((s) => s.currentEnvironmentId);
  const environments = useProjectStore((s) => s.environments);

  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [trigger, setTrigger] = useState<TriggerType>("smoke");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [browser, setBrowser] = useState<"chrome" | "chromium">("chrome");
  const [mode, setMode] = useState<"headed" | "headless">("headless");
  const [buildId, setBuildId] = useState("");
  const [log, setLog] = useState<string>("");
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<{ status: string; tests: { status: string; nodeId: string; errorMessage?: string }[] } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!currentProject) return;
    void window.studio.testCases.list(currentProject.id).then((r) => r.ok && setTestCases(r.data));
  }, [currentProject]);

  useEffect(() => {
    const unsubscribe = window.studio.execution.onEvent((event) => {
      if (event.type === "log") {
        setLog((l) => l + event.chunk);
        requestAnimationFrame(() => logRef.current?.scrollTo(0, logRef.current.scrollHeight));
      }
    });
    return unsubscribe;
  }, []);

  const automatedTestCases = useMemo(() => testCases.filter((t) => t.automationStatus === "automated"), [testCases]);
  const suiteMatches = useMemo(
    () => (trigger === "custom" ? [] : automatedTestCases.filter((t) => t.tags.includes(trigger))),
    [automatedTestCases, trigger]
  );

  const effectiveTestCaseIds = trigger === "custom" ? selectedIds : suiteMatches.map((t) => t.id);

  async function handleRun() {
    if (!currentProject || !currentEnvironmentId || effectiveTestCaseIds.length === 0) return;
    setIsRunning(true);
    setLog("");
    setResult(null);
    setError(null);
    const res = await window.studio.execution.run({
      projectId: currentProject.id,
      environmentId: currentEnvironmentId,
      testCaseIds: effectiveTestCaseIds,
      triggerType: trigger,
      browser,
      mode,
      buildId: buildId || undefined,
    });
    setIsRunning(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setResult(res.data.result as never);
  }

  if (!currentProject) return <p className="muted">Select a project first.</p>;

  return (
    <div className="stack">
      <h1>Run Tests</h1>

      <div className="card">
        <div className="row wrap">
          {[...SUITES, "custom" as TriggerType].map((t) => (
            <button key={t} className={trigger === t ? "primary" : ""} onClick={() => setTrigger(t)}>
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        {trigger === "custom" ? (
          <div className="stack" style={{ marginTop: 12 }}>
            <label style={{ textTransform: "none", fontWeight: 400 }}>Select automated tests to run</label>
            {automatedTestCases.map((t) => (
              <label key={t.id} style={{ display: "flex", gap: 8, alignItems: "center", textTransform: "none", fontWeight: 400 }}>
                <input
                  type="checkbox"
                  style={{ width: "auto" }}
                  checked={selectedIds.includes(t.id)}
                  onChange={(e) =>
                    setSelectedIds((prev) => (e.target.checked ? [...prev, t.id] : prev.filter((id) => id !== t.id)))
                  }
                />
                {t.displayId} — {t.title}
              </label>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ marginTop: 12 }}>
            {suiteMatches.length} automated test(s) tagged <span className="mono">{trigger}</span>
            {suiteMatches.length === 0 && " — tag tests with this suite and generate code to include them."}
          </p>
        )}

        <div className="row wrap" style={{ marginTop: 16, alignItems: "flex-end" }}>
          <div className="mini-field">
            <span className="mini-label">Environment</span>
            <select aria-label="Environment" value={currentEnvironmentId ?? ""} disabled style={{ minWidth: 130 }}>
              <option>{environments.find((e) => e.id === currentEnvironmentId)?.name ?? "No environment selected"}</option>
            </select>
          </div>
          <div className="mini-field">
            <span className="mini-label">Browser</span>
            <select aria-label="Browser" value={browser} onChange={(e) => setBrowser(e.target.value as typeof browser)}>
              <option value="chrome">Chrome</option>
              <option value="chromium">Chromium</option>
            </select>
          </div>
          <div className="mini-field">
            <span className="mini-label">Mode</span>
            <select aria-label="Execution mode" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="headless">Headless</option>
              <option value="headed">Headed</option>
            </select>
          </div>
          <div className="mini-field">
            <span className="mini-label">Build (optional)</span>
            <input aria-label="Build id" placeholder="e.g. 2026.09.22.1" value={buildId} onChange={(e) => setBuildId(e.target.value)} style={{ maxWidth: 160 }} />
          </div>
          <button
            className="primary"
            onClick={() => void handleRun()}
            disabled={isRunning || !currentEnvironmentId || effectiveTestCaseIds.length === 0}
          >
            {isRunning ? "Running…" : `Run ${trigger.toUpperCase()}`}
          </button>
        </div>
        {error && <div className="error-banner" style={{ marginTop: 12 }}>{error}</div>}
      </div>

      {(log || result) && (
        <div className="card">
          <h3>Live Log</h3>
          <pre
            ref={logRef}
            className="mono"
            style={{ background: "#0f1117", color: "#d7dbe3", padding: 12, borderRadius: 6, maxHeight: 220, overflow: "auto", fontSize: 12 }}
          >
            {log || "(no output yet)"}
          </pre>

          {result && (
            <div style={{ marginTop: 16 }}>
              <h3>
                Result: <span className={`badge ${result.status}`}>{result.status}</span>
              </h3>
              <table>
                <thead>
                  <tr>
                    <th>Test</th>
                    <th>Status</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {result.tests.map((t) => (
                    <tr key={t.nodeId}>
                      <td className="mono">{t.nodeId}</td>
                      <td>
                        <span className={`badge ${t.status}`}>{t.status}</span>
                      </td>
                      <td className="muted" style={{ maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {t.errorMessage ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
