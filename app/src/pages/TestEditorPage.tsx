import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import Editor from "@monaco-editor/react";
import {
  STEP_TYPES,
  STEPS_REQUIRING_TARGET,
  RANDOM_GENERATORS,
  BOUNDARY_KINDS,
  ASSERTION_TYPES,
  type TestStep,
  type TestModel,
  type TestValue,
  type LocatorStrategy,
  type LocatorQuality,
  type Assertion,
} from "@shared/testModel";
import { generateRandomValue, generateBoundaryValue } from "@shared/randomData";
import type { AutomationMapping, WriteOutcome } from "@shared/ipcApi";
import { useProjectStore } from "@/state/projectStore";

const BUILT_IN_TAGS = ["bvt", "smoke", "sanity", "regression"];
const STEPS_WITH_VALUE: string[] = ["fill", "select", "upload", "dragAndDrop", "pressKey", "navigate"];

function emptyTarget() {
  return { preferred: { strategy: "role" as LocatorStrategy, value: "", quality: "good" as LocatorQuality }, alternatives: [] };
}

function newStep(type: string): TestStep {
  const step: TestStep = { id: uuidv4(), type: type as TestStep["type"], enabled: true };
  if (STEPS_REQUIRING_TARGET.includes(step.type)) step.target = emptyTarget();
  if (STEPS_WITH_VALUE.includes(step.type)) step.value = { kind: "literal", value: "" };
  if (step.type === "assert") step.assertion = { type: "visible" };
  return step;
}

export default function TestEditorPage() {
  const { testCaseId } = useParams();
  const currentProject = useProjectStore((s) => s.currentProject());
  const currentEnvironmentId = useProjectStore((s) => s.currentEnvironmentId);
  const environments = useProjectStore((s) => s.environments);

  const [model, setModel] = useState<TestModel | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  const [genResult, setGenResult] = useState<WriteOutcome | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const [mapping, setMapping] = useState<AutomationMapping | null>(null);
  const [codeView, setCodeView] = useState<{ path: string; content: string } | null>(null);

  const [browser, setBrowser] = useState<"chrome" | "chromium">("chrome");
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
        <input
          style={{ fontSize: 18, fontWeight: 700, border: "none", background: "transparent", padding: 0 }}
          value={model.name}
          onChange={(e) => setModel({ ...model, name: e.target.value })}
        />
        <div className="spacer" />
        <button onClick={() => void handleSave()} disabled={isSaving} className="primary">
          {isSaving ? "Saving…" : "Save"}
        </button>
      </div>
      {saveError && <div className="error-banner">{saveError}</div>}
      {savedOk && !saveError && <div className="badge passed" style={{ width: "fit-content" }}>Saved</div>}

      <div className="card">
        <h3>Suites</h3>
        <div className="row wrap">
          {BUILT_IN_TAGS.map((tag) => (
            <label key={tag} style={{ display: "flex", alignItems: "center", gap: 6, textTransform: "none", fontWeight: 400 }}>
              <input type="checkbox" style={{ width: "auto" }} checked={model.tags.includes(tag)} onChange={() => toggleTag(tag)} />
              {tag}
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
          <select onChange={(e) => e.target.value && (addStep(e.target.value), (e.target.value = ""))} defaultValue="">
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

      <div className="card">
        <div className="row">
          <h3 style={{ margin: 0 }}>Generated Automation</h3>
          <div className="spacer" />
          <button onClick={() => void handleGenerate()} disabled={isGenerating}>
            {isGenerating ? "Generating…" : "Generate Code"}
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
          <div style={{ marginTop: 12, border: "1px solid var(--color-border)", borderRadius: 6, overflow: "hidden" }}>
            <div className="mono" style={{ padding: "6px 10px", background: "#f3f5f9", fontSize: 12 }}>
              {codeView.path}
            </div>
            <Editor height="360px" language="python" value={codeView.content} options={{ readOnly: true, minimap: { enabled: false } }} />
          </div>
        )}
      </div>

      <div className="card">
        <h3>Run</h3>
        <div className="row wrap">
          <select value={browser} onChange={(e) => setBrowser(e.target.value as typeof browser)}>
            <option value="chrome">Chrome</option>
            <option value="chromium">Chromium</option>
          </select>
          <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="headless">Headless</option>
            <option value="headed">Headed</option>
          </select>
          <span className="muted">Environment: {environments.find((e) => e.id === currentEnvironmentId)?.name ?? "none selected"}</span>
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

function StepRow({
  index,
  step,
  onChange,
  onRemove,
  onMove,
}: {
  index: number;
  step: TestStep;
  onChange: (updater: (s: TestStep) => TestStep) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const needsTarget = STEPS_REQUIRING_TARGET.includes(step.type);
  const needsValue = STEPS_WITH_VALUE.includes(step.type);

  return (
    <div className={`step-row${step.enabled ? "" : " disabled"}`}>
      <div className="step-row-head">
        <span className="step-index">{index + 1}</span>
        <span className="step-type-badge">{step.type}</span>
        <input
          placeholder="note (optional)"
          value={step.note ?? ""}
          onChange={(e) => onChange((s) => ({ ...s, note: e.target.value }))}
          style={{ maxWidth: 220 }}
        />
        <div className="spacer" />
        <button className="ghost" onClick={() => onMove(-1)} title="Move up">↑</button>
        <button className="ghost" onClick={() => onMove(1)} title="Move down">↓</button>
        <button className="ghost" onClick={() => onChange((s) => ({ ...s, enabled: !s.enabled }))}>
          {step.enabled ? "Disable" : "Enable"}
        </button>
        <button className="danger" onClick={onRemove}>
          Delete
        </button>
      </div>

      {needsTarget && step.target && (
        <div className="row wrap" style={{ marginTop: 8 }}>
          <select
            value={step.target.preferred.strategy}
            onChange={(e) =>
              onChange((s) => ({
                ...s,
                target: { ...s.target!, preferred: { ...s.target!.preferred, strategy: e.target.value as LocatorStrategy } },
              }))
            }
          >
            {(["role", "testId", "label", "placeholder", "text", "css", "xpath"] as LocatorStrategy[]).map((strat) => (
              <option key={strat} value={strat}>
                {strat}
              </option>
            ))}
          </select>
          <input
            placeholder={step.target.preferred.strategy === "role" ? "role, e.g. button" : "locator value"}
            value={step.target.preferred.value}
            onChange={(e) =>
              onChange((s) => ({ ...s, target: { ...s.target!, preferred: { ...s.target!.preferred, value: e.target.value } } }))
            }
          />
          {step.target.preferred.strategy === "role" && (
            <input
              placeholder="accessible name, e.g. Login"
              value={step.target.preferred.roleName ?? ""}
              onChange={(e) =>
                onChange((s) => ({ ...s, target: { ...s.target!, preferred: { ...s.target!.preferred, roleName: e.target.value } } }))
              }
            />
          )}
          <select
            value={step.target.preferred.quality}
            onChange={(e) =>
              onChange((s) => ({
                ...s,
                target: { ...s.target!, preferred: { ...s.target!.preferred, quality: e.target.value as LocatorQuality } },
              }))
            }
          >
            {(["excellent", "good", "fair", "fragile", "avoid"] as LocatorQuality[]).map((q) => (
              <option key={q} value={q}>
                {q}
              </option>
            ))}
          </select>
        </div>
      )}

      {needsValue && (
        <div style={{ marginTop: 8 }}>
          <ValueEditor value={step.value} onChange={(v) => onChange((s) => ({ ...s, value: v }))} />
        </div>
      )}

      {step.type === "assert" && step.assertion && (
        <div style={{ marginTop: 8 }}>
          <AssertionEditor assertion={step.assertion} onChange={(a) => onChange((s) => ({ ...s, assertion: a }))} />
        </div>
      )}
    </div>
  );
}

const ASSERTIONS_NEEDING_EXPECTED = ASSERTION_TYPES.filter(
  (a) => !["visible", "hidden", "enabled", "disabled", "checked", "unchecked"].includes(a)
);

function AssertionEditor({ assertion, onChange }: { assertion: Assertion; onChange: (a: Assertion) => void }) {
  const needsExpected = ASSERTIONS_NEEDING_EXPECTED.includes(assertion.type);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row wrap">
        <select value={assertion.type} onChange={(e) => onChange({ ...assertion, type: e.target.value as Assertion["type"] })}>
          {ASSERTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {assertion.type === "attributeEquals" && (
          <input
            placeholder="attribute name"
            value={assertion.attribute ?? ""}
            onChange={(e) => onChange({ ...assertion, attribute: e.target.value })}
          />
        )}
      </div>
      {needsExpected && (
        <ValueEditor value={assertion.expected} onChange={(v) => onChange({ ...assertion, expected: v })} />
      )}
    </div>
  );
}

function ValueEditor({ value, onChange }: { value: TestValue | undefined; onChange: (v: TestValue) => void }) {
  const kind = value?.kind ?? "literal";

  return (
    <div className="row wrap">
      <select
        value={kind}
        onChange={(e) => {
          const newKind = e.target.value as TestValue["kind"];
          if (newKind === "literal") onChange({ kind: "literal", value: "" });
          else if (newKind === "variable") onChange({ kind: "variable", path: "base_url" });
          else if (newKind === "random") onChange({ kind: "random", generator: "fullName", seedOnce: true });
          else onChange({ kind: "boundary", boundary: "empty" });
        }}
      >
        <option value="literal">Literal</option>
        <option value="variable">Variable</option>
        <option value="random">Random 🎲</option>
        <option value="boundary">Boundary</option>
      </select>

      {value?.kind === "literal" && (
        <input value={value.value} onChange={(e) => onChange({ kind: "literal", value: e.target.value })} placeholder="value" />
      )}

      {value?.kind === "variable" && (
        <input
          value={value.path}
          onChange={(e) => onChange({ kind: "variable", path: e.target.value })}
          placeholder="base_url / credentials.default.password"
          list="variable-suggestions"
        />
      )}

      {value?.kind === "random" && (
        <>
          <select
            value={value.generator}
            onChange={(e) => onChange({ ...value, generator: e.target.value as typeof value.generator })}
          >
            {RANDOM_GENERATORS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 4, textTransform: "none", fontWeight: 400 }}>
            <input
              type="checkbox"
              style={{ width: "auto" }}
              checked={value.seedOnce}
              onChange={(e) => onChange({ ...value, seedOnce: e.target.checked })}
            />
            Generate Once
          </label>
          <button
            type="button"
            onClick={() => onChange({ ...value, generatedValue: generateRandomValue(value.generator, value.pattern) })}
          >
            🎲 Preview
          </button>
          {value.generatedValue !== undefined && <span className="mono muted">{value.generatedValue}</span>}
        </>
      )}

      {value?.kind === "boundary" && (
        <>
          <select value={value.boundary} onChange={(e) => onChange({ kind: "boundary", boundary: e.target.value as typeof value.boundary })}>
            {BOUNDARY_KINDS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <span className="mono muted">{generateBoundaryValue(value.boundary).slice(0, 40)}</span>
        </>
      )}
      <datalist id="variable-suggestions">
        <option value="base_url" />
        <option value="api_url" />
        <option value="credentials.default.username" />
        <option value="credentials.default.password" />
      </datalist>
    </div>
  );
}
