import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Editor, { loader as monacoLoader } from "@monaco-editor/react";
// The bare "monaco-editor" package barrel pulls in every bundled language
// (SQL, Solidity, PowerQuery, ABAP, ...) this app never uses, for a ~4MB
// bundle — this viewer only ever shows generated Python. editor.api is
// monaco-editor's own minimal core entry point (the standalone editor
// itself, with no language definitions), and the Python module is the one
// opt-in language actually needed on top of it.
import * as monaco from "monaco-editor/editor/editor.api";
import "monaco-editor/languages/definitions/python/python.js";
import { STEP_TYPES, type TestStep, type TestModel } from "@shared/testModel";
import type { AutomationMapping, WriteOutcome, RecorderBrowser } from "@shared/ipcApi";
import { useProjectStore } from "@/state/projectStore";
import { BUILT_IN_TAGS, StepRow, newStep } from "@/components/StepEditor";
import { parseInstructionsToSteps } from "@shared/naturalLanguageSteps";
import { CredentialsUsedPanel } from "@/components/CredentialsUsedPanel";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EXECUTION_BROWSER_OPTIONS } from "@/lib/browserOptions";
import { FAILURE_CLASSIFICATION_EXPLANATIONS } from "@/components/charts/colors";

// @monaco-editor/react defaults to AMD-loading Monaco's core scripts from a
// CDN (cdn.jsdelivr.net) at runtime — blocked outright by this app's CSP
// (script-src 'self'), which the Studio has no reason to weaken just for
// this. Pointing the loader at the monaco-editor package already bundled
// into the app instead means it never touches the network at all. Runs
// once at module load, before the Editor component below ever mounts.
monacoLoader.config({ monaco });

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
  const [codeViewError, setCodeViewError] = useState<string | null>(null);

  const [browser, setBrowser] = useState<RecorderBrowser>("chrome");
  const [mode, setMode] = useState<"headed" | "headless">("headless");
  const [runResult, setRunResult] = useState<{
    status: string;
    passed: number;
    total: number;
    failedStepIndex?: number;
    failedStepDescription?: string;
    failureClassification?: string;
  } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const [showNlBuilder, setShowNlBuilder] = useState(false);
  const [nlText, setNlText] = useState("");
  const [nlWarnings, setNlWarnings] = useState<string[]>([]);
  const [nlAddedCount, setNlAddedCount] = useState<number | null>(null);

  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewResults, setPreviewResults] = useState<
    Record<string, { status: "running" | "passed" | "failed" | "skipped"; message?: string; matchedStrategy?: string }>
  >({});
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!testCaseId) return;
    void window.studio.testCases.get(testCaseId).then((r) => {
      if (r.ok && r.data) setModel(r.data.testModel);
    });
    void window.studio.codegen.getMapping(testCaseId).then((r) => {
      if (r.ok) setMapping(r.data);
    });
  }, [testCaseId]);

  useEffect(() => {
    const unsubscribe = window.studio.preview.onEvent((event) => {
      if (event.type === "stepStart") {
        setPreviewResults((prev) => ({ ...prev, [event.stepId]: { status: "running" } }));
      } else if (event.type === "stepResult") {
        setPreviewResults((prev) => ({
          ...prev,
          [event.stepId]: { status: event.status, message: event.message, matchedStrategy: event.matchedStrategy },
        }));
      } else if (event.type === "finished" || event.type === "closed") {
        previewIdRef.current = null;
        setPreviewId(null);
      }
    });
    return unsubscribe;
  }, []);

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
  function handleParseInstructions() {
    const { steps, warnings } = parseInstructionsToSteps(nlText);
    if (steps.length > 0) {
      setModel((m) => (m ? { ...m, steps: [...m.steps, ...steps] } : m));
    }
    setNlWarnings(warnings);
    setNlAddedCount(steps.length);
    if (warnings.length === 0) setNlText("");
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
    // Refresh whichever file is currently shown (or the main test file, if
    // none is open yet) so the viewer reflects what was just written —
    // the auto-open effect below only re-runs when the generated file's
    // *path* changes, so regenerating the same file again (the common
    // case — editing steps, then clicking "Regenerate Code") would
    // otherwise leave a stale or empty view.
    const pathToShow = codeView?.path ?? (mappingRes.ok ? mappingRes.data?.generatedTestFile : undefined);
    if (pathToShow) void openCodeFile(pathToShow);
  }

  async function openCodeFile(relativePath: string) {
    if (!currentProject) return;
    setCodeView(null);
    setCodeViewError(null);
    const res = await window.studio.codegen.readFile(currentProject.id, relativePath);
    if (res.ok) {
      setCodeView({ path: relativePath, content: res.data.content });
    } else {
      // Previously failed silently — the viewer just stayed empty with no
      // indication why, which is indistinguishable from "the code
      // generator doesn't show the code" from the outside. The most common
      // real cause is the file having been moved/deleted on disk since it
      // was generated (e.g. the project directory changed), which
      // "Regenerate Code" fixes by writing it back.
      setCodeViewError(`Couldn't open ${relativePath}: ${res.error}`);
    }
  }

  async function handleRun() {
    if (!testCaseId || !currentEnvironmentId) return;
    setIsRunning(true);
    setRunResult(null);
    setRunError(null);
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
      setRunError(res.error);
      return;
    }
    const r = res.data.result as {
      status: string;
      tests: { status: string; failedStepIndex?: number; failedStepDescription?: string; failureClassification?: string }[];
    };
    const failedTest = r.tests.find((t) => t.status !== "passed");
    setRunResult({
      status: r.status,
      passed: r.tests.filter((t) => t.status === "passed").length,
      total: r.tests.length,
      failedStepIndex: failedTest?.failedStepIndex,
      failedStepDescription: failedTest?.failedStepDescription,
      failureClassification: failedTest?.failureClassification,
    });
  }

  async function handleTryIt() {
    if (!model || !environment) return;
    setPreviewError(null);
    setPreviewResults({});
    const res = await window.studio.preview.start(model.steps, { base_url: environment.baseUrl }, browser);
    if (!res.ok) {
      setPreviewError(res.error);
      return;
    }
    previewIdRef.current = res.data.previewId;
    setPreviewId(res.data.previewId);
  }

  async function handleStopPreview() {
    const id = previewIdRef.current;
    if (!id) return;
    await window.studio.preview.stop(id);
    previewIdRef.current = null;
    setPreviewId(null);
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
          <button className="ghost" onClick={() => setShowNlBuilder((v) => !v)}>
            {showNlBuilder ? "Hide" : "✍️ Describe steps in plain English"}
          </button>
          {previewId ? (
            <button className="ghost danger" onClick={() => void handleStopPreview()}>
              ⏹ Stop Preview
            </button>
          ) : (
            <button
              className="ghost"
              onClick={() => void handleTryIt()}
              disabled={!environment || model.steps.length === 0}
              title={!environment ? "Select an environment first" : "Opens a real browser window and runs these steps live"}
            >
              ▶ Try It in a Browser
            </button>
          )}
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

        {showNlBuilder && (
          <div className="stack" style={{ marginTop: 12, padding: 12, background: "#f6f6fd", borderRadius: 8 }}>
            <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
              One action per line — e.g. <span className="mono">Go to https://example.com</span>,{" "}
              <span className="mono">Click on the Login button</span>,{" "}
              <span className="mono">Fill Username with John</span>,{" "}
              <span className="mono">Add random value in Health Plan Name</span>. Each line becomes a step below,
              which you can review and adjust before saving — the locator it guesses from the wording is a first
              draft, not exact.
            </p>
            <textarea
              aria-label="Plain-English test steps"
              value={nlText}
              onChange={(e) => setNlText(e.target.value)}
              rows={6}
              placeholder={"Go to https://example.com\nClick on the Login button\nFill Username with John\nAdd random value in Health Plan Name"}
              style={{ fontFamily: "monospace", fontSize: 13 }}
            />
            <div className="row">
              <button className="primary" onClick={handleParseInstructions} disabled={!nlText.trim()}>
                Parse &amp; Add Steps
              </button>
              {nlAddedCount !== null && nlWarnings.length === 0 && (
                <span className="muted">
                  Added {nlAddedCount} step{nlAddedCount === 1 ? "" : "s"}.
                </span>
              )}
            </div>
            {nlWarnings.length > 0 && (
              <div className="error-banner stack">
                <strong>
                  {nlAddedCount ? `Added ${nlAddedCount} step(s); ` : ""}
                  {nlWarnings.length} line{nlWarnings.length === 1 ? "" : "s"} couldn't be understood:
                </strong>
                {nlWarnings.map((w) => (
                  <span key={w} className="mono" style={{ fontSize: 12 }}>
                    {w}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {previewError && <div className="error-banner" style={{ marginTop: 12 }}>{previewError}</div>}
        {(previewId || Object.keys(previewResults).length > 0) && (
          <div className="stack" style={{ marginTop: 12, padding: 12, background: "#f6f6fd", borderRadius: 8, gap: 4 }}>
            <div className="row" style={{ gap: 6 }}>
              <strong style={{ fontSize: 13 }}>{previewId ? "Running in browser…" : "Preview finished"}</strong>
            </div>
            {model.steps.map((step, idx) => {
              const r = previewResults[step.id];
              if (!r) return null;
              const icon = r.status === "running" ? "⏳" : r.status === "passed" ? "✅" : r.status === "skipped" ? "⏭️" : "❌";
              return (
                <div key={step.id} className="row" style={{ gap: 8, fontSize: 12.5 }}>
                  <span>{icon}</span>
                  <span className="mono muted">
                    Step {idx + 1} — {step.type}
                  </span>
                  {r.matchedStrategy && <span className="muted">matched {r.matchedStrategy}</span>}
                  {r.message && <span className={r.status === "failed" ? "" : "muted"}>{r.message}</span>}
                </div>
              );
            })}
          </div>
        )}

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
        {codeViewError && (
          <div className="error-banner stack" style={{ marginTop: 12 }}>
            <strong>{codeViewError}</strong>
            <span>If the project's files were moved, deleted, or the project directory changed, click "Regenerate Code" above to write them back.</span>
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
        {runError && <div className="error-banner">{runError}</div>}
        {runResult && (
          <div className="stack" style={{ gap: 4 }}>
            <p className="mono" style={{ margin: 0 }}>
              Status: {runResult.status} ({runResult.passed}/{runResult.total} passed)
            </p>
            {runResult.failedStepIndex != null && (
              <p style={{ margin: 0, fontWeight: 600 }}>
                Failed at Step {runResult.failedStepIndex}
                {runResult.failedStepDescription ? (
                  <>
                    : <span className="mono" style={{ fontWeight: 400 }}>{runResult.failedStepDescription}</span>
                  </>
                ) : null}
              </p>
            )}
            {runResult.failureClassification && (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                {FAILURE_CLASSIFICATION_EXPLANATIONS[runResult.failureClassification] ?? ""}{" "}
                <Link to="/reports">See full details in Execution History →</Link>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
