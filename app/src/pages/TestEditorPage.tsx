import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Editor from "@monaco-editor/react";
import { STEP_TYPES, type TestStep, type TestModel } from "@shared/testModel";
import type { AutomationMapping, WriteOutcome, RecorderBrowser } from "@shared/ipcApi";
import { useProjectStore } from "@/state/projectStore";
import { BUILT_IN_TAGS, StepRow, newStep } from "@/components/StepEditor";
import { CredentialsUsedPanel } from "@/components/CredentialsUsedPanel";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EXECUTION_BROWSER_OPTIONS } from "@/lib/browserOptions";

export default function TestEditorPage() {
  const { testCaseId } = useParams();
  const navigate = useNavigate();
  const currentProject = useProjectStore((s) => s.currentProject());
  const currentEnvironmentId = useProjectStore((s) => s.currentEnvironmentId);
  const environments = useProjectStore((s) => s.environments);
  const selectProject = useProjectStore((s) => s.selectProject);
  const environment = environments.find((e) => e.id === currentEnvironmentId);

  const [model, setModel] = useState<TestModel | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [genResult, setGenResult] = useState<WriteOutcome | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const [mapping, setMapping] = useState<AutomationMapping | null>(null);
  const [codeView, setCodeView] = useState<{ path: string; content: string } | null>(null);

  const [browser, setBrowser] = useState<RecorderBrowser>("chrome");
  const [mode, setMode] = useState<"headed" | "headless">("headless");
  const [runResult, setRunResult] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    if (!testCaseId) return;
    void window.studio.testCases.get(testCaseId).then((r) => {
      if (r.ok && r.data) setModel(r.data.testModel);
    });
    void window.studio.codegen.getMapping(testCaseId).then((r) => {
      if (r.ok) setMapping(r.data);
    });
  }, [testCaseId]);

  // If this test already has generated code, show it immediately rather
  // than making the user click "Generate Code" again just to see what was
  // produced (this is especially useful right after saving a recording).
  useEffect(() => {
    if (mapping?.generatedTestFile && currentProject) {
      void openCodeFile(mapping.generatedTestFile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapping?.generatedTestFile, currentProject?.id]);

  function updateStep(id: string, updater: (s: TestStep) => TestStep) {
    setModel((m) => (m ? { ...m, steps: m.steps.map((s) => (s.id === id ? updater(s) : s)) } : m));
  }
  function removeStep(id: string) {
    setModel((m) => (m ? { ...m, steps: m.steps.filter((s) => s.id !== id) } : m));
  }
  function moveStep(id: string, dir: -1 | 1) {
    setModel((m) => {
      if (!m) return m;
      const idx = m.steps.findIndex((s) => s.id === id);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= m.steps.length) return m;
      const steps = [...m.steps];
      [steps[idx], steps[target]] = [steps[target], steps[idx]];
      return { ...m, steps };
    });
  }
  function addStep(type: string) {
    setModel((m) => (m ? { ...m, steps: [...m.steps, newStep(type)] } : m));
  }
  function toggleTag(tag: string) {
    setModel((m) => {
      if (!m) return m;
      const has = m.tags.includes(tag);
      return { ...m, tags: has ? m.tags.filter((t) => t !== tag) : [...m.tags, tag] };
    });
  }

  async function handleSave() {
    if (!model || !testCaseId) return;
    setIsSaving(true);
    setSaveError(null);
    setSavedOk(false);
    const res = await window.studio.testCases.saveModel(testCaseId, model);
    setIsSaving(false);
    if (!res.ok) {
      setSaveError(res.error);
      return;
    }
    setSavedOk(true);
    setModel(res.data.testModel);
  }

  async function handleDelete() {
    if (!testCaseId) return;
    setIsDeleting(true);
    const res = await window.studio.testCases.delete(testCaseId);
    setIsDeleting(false);
    if (res.ok) navigate("/tests");
  }

  async function handleGenerate(forcePaths?: string[]) {
    if (!testCaseId) return;
    setIsGenerating(true);
    setGenError(null);
    const res = await window.studio.codegen.generate(testCaseId, forcePaths);
    setIsGenerating(false);
    if (!res.ok) {
      setGenError(res.error);
      return;
    }
    setGenResult(res.data);
    const mappingRes = await window.studio.codegen.getMapping(testCaseId);
    if (mappingRes.ok) setMapping(mappingRes.data);
  }

  async function openCodeFile(relativePath: string) {
    if (!currentProject) return;
    const res = await window.studio.codegen.readFile(currentProject.id, relativePath);
    if (res.ok) setCodeView({ path: relativePath, content: res.data.content });
  }

  async function handleRun() {
    if (!testCaseId || !currentEnvironmentId) return;
    setIsRunning(true);
    setRunResult(null);
    const res = await window.studio.execution.run({
      projectId: currentProject!.id,
      environmentId: currentEnvironmentId,
      testCaseIds: [testCaseId],
      triggerType: "single",
      browser,
      mode,
    });
    setIsRunning(false);
    if (!res.ok) {
      setRunResult(`Error: ${res.error}`);
      return;
    }
    const r = res.data.result as { status: string; tests: { status: string }[] };
    setRunResult(`Status: ${r.status} (${r.tests.filter((t) => t.status === "passed").length}/${r.tests.length} passed)`);
  }

  const customTags = useMemo(() => model?.tags.filter((t) => !BUILT_IN_TAGS.includes(t)) ?? [], [model]);

  if (!model) return <p className="muted">Loading…</p>;

  return (
    <div className="stack">
      <div className="row">
        <div className="mini-field" style={{ minWidth: 320 }}>
          <span className="mini-label">Test Name</span>
          <input
            aria-label="Test name"
            style={{ fontSize: 17, fontWeight: 700 }}
            value={model.name}
            onChange={(e) => setModel({ ...model, name: e.target.value })}
          />
        </div>
        <div className="spacer" />
        <button className="danger" onClick={() => setShowDeleteConfirm(true)}>
          Delete Test
        </button>
        <button onClick={() => void handleSave()} disabled={isSaving} className="primary">
          {isSaving ? "Saving…" : "Save"}
        </button>
      </div>
      {saveError && <div className="error-banner">{saveError}</div>}
      {savedOk && !saveError && <div className="badge passed" style={{ width: "fit-content" }}>Saved</div>}

      {showDeleteConfirm && (
        <ConfirmDialog
          title="Delete this test case?"
          message={`"${model.name}" and its generation history will be removed. Past execution results are kept for reporting. This can't be undone.`}
          confirmLabel={isDeleting ? "Deleting…" : "Delete"}
          onConfirm={() => void handleDelete()}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}

      <div className="card">
        <h3>Suites</h3>
        <p className="muted" style={{ marginTop: -4, marginBottom: 12, fontSize: 12 }}>
          A test can belong to more than one suite at once — select all that apply.
        </p>
        <div className="row wrap">
          {BUILT_IN_TAGS.map((tag) => (
            <label key={tag} className={`suite-toggle${model.tags.includes(tag) ? " active" : ""}`}>
              <input type="checkbox" checked={model.tags.includes(tag)} onChange={() => toggleTag(tag)} />
              {model.tags.includes(tag) ? "✓ " : ""}
              {tag.toUpperCase()}
            </label>
          ))}
          {customTags.map((tag) => (
            <span key={tag} className="tag-chip">
              {tag}
              <button className="ghost" style={{ padding: 0, border: "none" }} onClick={() => toggleTag(tag)}>
                ×
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="row">
          <h3 style={{ margin: 0 }}>Steps</h3>
          <div className="spacer" />
          <select aria-label="Add step" onChange={(e) => e.target.value && (addStep(e.target.value), (e.target.value = ""))} defaultValue="">
            <option value="" disabled>
              + Add step…
            </option>
            {STEP_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="step-list" style={{ marginTop: 12 }}>
          {model.steps.map((step, idx) => (
            <StepRow
              key={step.id}
              index={idx}
              step={step}
              onChange={(updater) => updateStep(step.id, updater)}
              onRemove={() => removeStep(step.id)}
              onMove={(dir) => moveStep(step.id, dir)}
            />
          ))}
          {model.steps.length === 0 && <p className="muted">No steps yet. Add one above.</p>}
        </div>
      </div>

      {currentProject && (
        <CredentialsUsedPanel
          projectId={currentProject.id}
          environment={environment}
          steps={model.steps}
          onEnvironmentUpdated={() => void selectProject(currentProject.id)}
        />
      )}

      <div className="card">
        <div className="row">
          <h3 style={{ margin: 0 }}>Generated Automation</h3>
          <div className="spacer" />
          <button onClick={() => void handleGenerate()} disabled={isGenerating}>
            {isGenerating ? "Generating…" : mapping ? "Regenerate Code" : "Generate Code"}
          </button>
        </div>
        {genError && <div className="error-banner">{genError}</div>}
        {mapping && (
          <p className="muted" style={{ fontSize: 12.5 }}>
            <span className="mono">{mapping.generatedTestFile}</span> · Page Objects:{" "}
            {mapping.pageObjectFiles.map((f) => (
              <span key={f} className="mono" style={{ marginRight: 6 }}>
                {f}
              </span>
            ))}
            {mapping.sourceOrigin === "manually_modified" && <span className="badge failed" style={{ marginLeft: 8 }}>Manually modified</span>}
          </p>
        )}
        {genResult && (
          <div className="stack" style={{ fontSize: 13 }}>
            {genResult.warnings.length > 0 && (
              <div className="coming-soon-banner">
                {genResult.warnings.map((w, i) => (
                  <div key={i}>{w}</div>
                ))}
              </div>
            )}
            {genResult.written.length > 0 && (
              <div>
                <strong>Written:</strong>{" "}
                {genResult.written.map((f) => (
                  <button key={f} className="ghost mono" style={{ textDecoration: "underline" }} onClick={() => void openCodeFile(f)}>
                    {f}
                  </button>
                ))}
              </div>
            )}
            {genResult.conflicts.length > 0 && (
              <div className="error-banner stack">
                <strong>These files were edited outside the Studio and were not overwritten:</strong>
                {genResult.conflicts.map((c) => (
                  <div key={c.relativePath} className="row">
                    <span className="mono">{c.relativePath}</span>
                    <button onClick={() => void handleGenerate([c.relativePath])}>Overwrite with generated version</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {codeView && (
          <div style={{ marginTop: 12, border: "1px solid var(--color-border)", borderRadius: 10, overflow: "hidden" }}>
            <div className="mono row" style={{ padding: "8px 12px", background: "#f6f6fd", fontSize: 12 }}>
              {codeView.path}
              <div className="spacer" />
              <span className="muted" style={{ fontSize: 11 }}>
                Generated — read only
              </span>
            </div>
            <Editor height="360px" language="python" value={codeView.content} options={{ readOnly: true, minimap: { enabled: false } }} />
          </div>
        )}
      </div>

      <div className="card">
        <h3>Run</h3>
        <div className="row wrap" style={{ alignItems: "flex-end" }}>
          <div className="mini-field">
            <span className="mini-label">Browser</span>
            <select aria-label="Browser" value={browser} onChange={(e) => setBrowser(e.target.value as RecorderBrowser)}>
              {EXECUTION_BROWSER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="mini-field">
            <span className="mini-label">Mode</span>
            <select aria-label="Execution mode" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="headless">Headless</option>
              <option value="headed">Headed</option>
            </select>
          </div>
          <span className="muted">Environment: {environment?.name ?? "none selected"}</span>
          <button className="primary" onClick={() => void handleRun()} disabled={isRunning || !currentEnvironmentId || !mapping}>
            {isRunning ? "Running…" : "Run Test"}
          </button>
        </div>
        {!mapping && <p className="muted" style={{ fontSize: 12.5 }}>Generate code before running.</p>}
        {runResult && <p className="mono">{runResult}</p>}
      </div>
    </div>
  );
}
