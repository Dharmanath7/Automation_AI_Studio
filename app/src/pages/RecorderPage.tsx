import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProjectStore } from "@/state/projectStore";
import { BUILT_IN_TAGS, StepRow, useStepList } from "@/components/StepEditor";
import { CredentialsUsedPanel } from "@/components/CredentialsUsedPanel";
import { STEP_TYPES, type TestStep } from "@shared/testModel";

type Phase = "configure" | "recording" | "review";

export default function RecorderPage() {
  const navigate = useNavigate();
  const currentProject = useProjectStore((s) => s.currentProject());
  const currentEnvironmentId = useProjectStore((s) => s.currentEnvironmentId);
  const environments = useProjectStore((s) => s.environments);
  const environment = environments.find((e) => e.id === currentEnvironmentId);

  const [phase, setPhase] = useState<Phase>("configure");
  const [browser, setBrowser] = useState<"chrome" | "chromium">("chrome");
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [liveSteps, setLiveSteps] = useState<TestStep[]>([]);
  const [startError, setStartError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [closedUnexpectedly, setClosedUnexpectedly] = useState(false);

  const [name, setName] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const recordingIdRef = useRef<string | null>(null);
  const { steps, setSteps, updateStep, removeStep, moveStep, addStep } = useStepList([]);

  useEffect(() => {
    const unsubscribe = window.studio.recorder.onEvent((event) => {
      if (event.type === "step") {
        setLiveSteps((prev) => [...prev, event.step]);
      } else if (event.type === "closed") {
        // The user closed the recorded browser window directly instead of
        // clicking "Stop Recording" in the Studio — treat it the same as
        // Stop, using whatever steps were captured so nothing is lost.
        if (recordingIdRef.current) {
          setClosedUnexpectedly(true);
          finishRecording();
        }
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleStart() {
    if (!environment) return;
    setIsStarting(true);
    setStartError(null);
    setClosedUnexpectedly(false);
    setLiveSteps([]);
    const res = await window.studio.recorder.start(environment.baseUrl, browser);
    setIsStarting(false);
    if (!res.ok) {
      setStartError(res.error);
      return;
    }
    recordingIdRef.current = res.data.recordingId;
    setRecordingId(res.data.recordingId);
    setPhase("recording");
  }

  function finishRecording() {
    // Mirrors the authoritative-list semantics of handleStop() below — this
    // is a fallback path (the recorded browser was closed directly instead
    // of via "Stop Recording"), so it replaces rather than appends, or a
    // leftover step list from a prior discarded recording would double up.
    setSteps(liveStepsRef.current);
    setPhase("review");
    recordingIdRef.current = null;
    setRecordingId(null);
  }

  // Keep a ref mirror of liveSteps so the "closed" event handler (registered
  // once on mount) reads the latest captured steps, not a stale closure.
  const liveStepsRef = useRef<TestStep[]>([]);
  useEffect(() => {
    liveStepsRef.current = liveSteps;
  }, [liveSteps]);

  async function handleStop() {
    if (!recordingId) return;
    const res = await window.studio.recorder.stop(recordingId);
    if (res.ok) {
      setSteps(res.data.steps);
    } else {
      setSteps(liveSteps);
    }
    recordingIdRef.current = null;
    setRecordingId(null);
    setPhase("review");
  }

  function toggleTag(tag: string) {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  async function handleSaveAsTestCase() {
    if (!currentProject || !name.trim()) return;
    setIsSaving(true);
    setSaveError(null);
    const createRes = await window.studio.testCases.create({ projectId: currentProject.id, title: name.trim(), tags });
    if (!createRes.ok) {
      setIsSaving(false);
      setSaveError(createRes.error);
      return;
    }
    const testCaseId = createRes.data.id;
    const model = { ...createRes.data.testModel, name: name.trim(), tags, steps };
    const saveRes = await window.studio.testCases.saveModel(testCaseId, model);
    if (!saveRes.ok) {
      setIsSaving(false);
      setSaveError(saveRes.error);
      return;
    }
    // Generate code now so the editor can show it immediately on arrival,
    // instead of the user having to click "Generate Code" again.
    await window.studio.codegen.generate(testCaseId);
    setIsSaving(false);
    navigate(`/tests/${testCaseId}`);
  }

  if (!currentProject) return <p className="muted">Select a project first.</p>;

  return (
    <div className="stack">
      <h1>Record Browser</h1>

      {phase === "configure" && (
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>
            Launches a real browser window against the selected environment. Every click, fill, check, select, and
            navigation is captured live below as you interact with it. Password fields are never recorded as literal
            text — they're stored as a Credential Vault reference automatically.
          </p>
          {!environment && <div className="error-banner">Select an environment from the top bar first.</div>}
          <div className="row wrap" style={{ alignItems: "flex-end" }}>
            <div className="mini-field">
              <span className="mini-label">Environment</span>
              <input aria-label="Environment" value={environment?.name ?? "none selected"} disabled style={{ minWidth: 140 }} />
            </div>
            <div className="mini-field">
              <span className="mini-label">Browser</span>
              <select aria-label="Browser" value={browser} onChange={(e) => setBrowser(e.target.value as typeof browser)}>
                <option value="chrome">Chrome</option>
                <option value="chromium">Chromium</option>
              </select>
            </div>
            <button className="primary" onClick={() => void handleStart()} disabled={!environment || isStarting}>
              {isStarting ? "Launching…" : "Launch Recorder"}
            </button>
          </div>
          {startError && <div className="error-banner" style={{ marginTop: 12 }}>{startError}</div>}
        </div>
      )}

      {phase === "recording" && (
        <div className="card">
          <div className="row">
            <span className="badge running">Recording</span>
            <span className="muted">Interact with the browser window that opened. Steps appear below as you go.</span>
            <div className="spacer" />
            <button className="primary" onClick={() => void handleStop()}>
              Stop Recording
            </button>
          </div>
          <div className="step-list" style={{ marginTop: 16 }}>
            {liveSteps.length === 0 && <p className="muted">No actions captured yet.</p>}
            {liveSteps.map((step, idx) => (
              <div key={step.id} className="step-row">
                <div className="step-row-head">
                  <span className="step-index">{idx + 1}</span>
                  <span className="step-type-badge">{step.type}</span>
                  <span className="mono muted">
                    {step.target?.preferred.roleName ?? step.target?.preferred.value ?? (step.value?.kind === "variable" ? step.value.path : "")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {phase === "review" && (
        <>
          {closedUnexpectedly && (
            <div className="coming-soon-banner">
              The recorded browser window was closed directly — the {steps.length} step(s) captured before it closed
              are kept below.
            </div>
          )}
          <div className="card">
            <div className="field">
              <label htmlFor="recordedTestName">Test Name</label>
              <input id="recordedTestName" value={name} onChange={(e) => setName(e.target.value)} placeholder="Search Provider" autoFocus />
            </div>
            <div className="field">
              <label>Suites</label>
              <p className="muted" style={{ marginTop: -2, marginBottom: 8, fontSize: 12 }}>
                A test can belong to more than one suite at once — select all that apply.
              </p>
              <div className="row wrap">
                {BUILT_IN_TAGS.map((tag) => (
                  <label key={tag} className={`suite-toggle${tags.includes(tag) ? " active" : ""}`}>
                    <input type="checkbox" checked={tags.includes(tag)} onChange={() => toggleTag(tag)} />
                    {tags.includes(tag) ? "✓ " : ""}
                    {tag.toUpperCase()}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="row">
              <h3 style={{ margin: 0 }}>Steps</h3>
              <span className="muted">Edit locators, delete noise, mark any field as random/boundary data before saving.</span>
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
              {steps.map((step, idx) => (
                <StepRow
                  key={step.id}
                  index={idx}
                  step={step}
                  onChange={(updater) => updateStep(step.id, updater)}
                  onRemove={() => removeStep(step.id)}
                  onMove={(dir) => moveStep(step.id, dir)}
                />
              ))}
              {steps.length === 0 && <p className="muted">No steps recorded. Go back and record, or add steps manually.</p>}
            </div>
          </div>

          {currentProject && <CredentialsUsedPanel projectId={currentProject.id} environment={environment} steps={steps} />}

          {saveError && <div className="error-banner">{saveError}</div>}
          <div className="row">
            <button
              onClick={() => {
                setSteps([]);
                setLiveSteps([]);
                setName("");
                setTags([]);
                setPhase("configure");
              }}
            >
              Discard &amp; record again
            </button>
            <div className="spacer" />
            <button className="primary" onClick={() => void handleSaveAsTestCase()} disabled={isSaving || !name.trim()}>
              {isSaving ? "Saving…" : "Save as Test Case"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
