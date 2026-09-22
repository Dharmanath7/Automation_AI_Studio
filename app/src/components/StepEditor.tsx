import { useState } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  STEPS_REQUIRING_TARGET,
  RANDOM_GENERATORS,
  BOUNDARY_KINDS,
  ASSERTION_TYPES,
  type TestStep,
  type TestValue,
  type LocatorStrategy,
  type LocatorQuality,
  type Assertion,
} from "@shared/testModel";
import { generateRandomValue, generateBoundaryValue } from "@shared/randomData";

/**
 * Shared visual step-editing UI — used by both the manual Test Editor
 * (editing an existing test's steps) and the Recorder review screen
 * (editing steps just captured from a live browser) so "add random data to
 * a recorded field" and "edit a manually built step" are the same code
 * path, not two.
 */

export const BUILT_IN_TAGS = ["bvt", "smoke", "sanity", "regression"];
export const STEPS_WITH_VALUE: string[] = ["fill", "select", "upload", "dragAndDrop", "pressKey", "navigate"];

export function emptyTarget() {
  return { preferred: { strategy: "role" as LocatorStrategy, value: "", quality: "good" as LocatorQuality }, alternatives: [] };
}

export function newStep(type: string): TestStep {
  const step: TestStep = { id: uuidv4(), type: type as TestStep["type"], enabled: true };
  if (STEPS_REQUIRING_TARGET.includes(step.type)) step.target = emptyTarget();
  if (STEPS_WITH_VALUE.includes(step.type)) step.value = { kind: "literal", value: "" };
  if (step.type === "assert") step.assertion = { type: "visible" };
  return step;
}

/** CRUD helpers for an editable step array — shared by the Test Editor and the Recorder review screen. */
export function useStepList(initial: TestStep[] = []) {
  const [steps, setSteps] = useState<TestStep[]>(initial);

  function updateStep(id: string, updater: (s: TestStep) => TestStep) {
    setSteps((prev) => prev.map((s) => (s.id === id ? updater(s) : s)));
  }
  function removeStep(id: string) {
    setSteps((prev) => prev.filter((s) => s.id !== id));
  }
  function moveStep(id: string, dir: -1 | 1) {
    setSteps((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }
  function addStep(type: string) {
    setSteps((prev) => [...prev, newStep(type)]);
  }
  function appendStep(step: TestStep) {
    setSteps((prev) => [...prev, step]);
  }

  return { steps, setSteps, updateStep, removeStep, moveStep, addStep, appendStep };
}

export function StepRow({
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
          aria-label="Step note (optional)"
          placeholder="Note (optional)"
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
        <div className="row wrap" style={{ marginTop: 8, alignItems: "flex-end" }}>
          <div className="mini-field">
            <span className="mini-label">Locator Strategy</span>
            <select
              aria-label="Locator strategy"
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
          </div>
          <div className="mini-field">
            <span className="mini-label">{step.target.preferred.strategy === "role" ? "Role" : "Locator Value"}</span>
            <input
              aria-label="Locator value"
              placeholder={step.target.preferred.strategy === "role" ? "e.g. button" : "locator value"}
              value={step.target.preferred.value}
              onChange={(e) =>
                onChange((s) => ({ ...s, target: { ...s.target!, preferred: { ...s.target!.preferred, value: e.target.value } } }))
              }
            />
          </div>
          {step.target.preferred.strategy === "role" && (
            <div className="mini-field">
              <span className="mini-label">Accessible Name</span>
              <input
                aria-label="Accessible name"
                placeholder="e.g. Login"
                value={step.target.preferred.roleName ?? ""}
                onChange={(e) =>
                  onChange((s) => ({ ...s, target: { ...s.target!, preferred: { ...s.target!.preferred, roleName: e.target.value } } }))
                }
              />
            </div>
          )}
          <div className="mini-field">
            <span className="mini-label">Locator Quality</span>
            <select
              aria-label="Locator quality"
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

export function AssertionEditor({ assertion, onChange }: { assertion: Assertion; onChange: (a: Assertion) => void }) {
  const needsExpected = ASSERTIONS_NEEDING_EXPECTED.includes(assertion.type);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row wrap" style={{ alignItems: "flex-end" }}>
        <div className="mini-field">
          <span className="mini-label">Assertion Type</span>
          <select aria-label="Assertion type" value={assertion.type} onChange={(e) => onChange({ ...assertion, type: e.target.value as Assertion["type"] })}>
            {ASSERTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        {assertion.type === "attributeEquals" && (
          <div className="mini-field">
            <span className="mini-label">Attribute Name</span>
            <input
              aria-label="Attribute name"
              placeholder="e.g. aria-disabled"
              value={assertion.attribute ?? ""}
              onChange={(e) => onChange({ ...assertion, attribute: e.target.value })}
            />
          </div>
        )}
      </div>
      {needsExpected && <ValueEditor value={assertion.expected} onChange={(v) => onChange({ ...assertion, expected: v })} label="Expected Value" />}
    </div>
  );
}

export function ValueEditor({
  value,
  onChange,
  label = "Value Source",
}: {
  value: TestValue | undefined;
  onChange: (v: TestValue) => void;
  label?: string;
}) {
  const kind = value?.kind ?? "literal";

  return (
    <div className="row wrap" style={{ alignItems: "flex-end" }}>
      <div className="mini-field">
        <span className="mini-label">{label}</span>
        <select
          aria-label={label}
          value={kind}
          onChange={(e) => {
            const newKind = e.target.value as TestValue["kind"];
            if (newKind === "literal") onChange({ kind: "literal", value: "" });
            else if (newKind === "variable") onChange({ kind: "variable", path: "base_url" });
            // Default to a garbage-looking string, not a realistic name —
            // most fields aren't a name field, and "James Smith" showing up
            // for an arbitrary text box reads as a real (if fake) person
            // more than obviously-generated test data does.
            else if (newKind === "random") onChange({ kind: "random", generator: "randomString", seedOnce: true });
            else onChange({ kind: "boundary", boundary: "empty" });
          }}
        >
          <option value="literal">Literal</option>
          <option value="variable">Variable</option>
          <option value="random">Random 🎲</option>
          <option value="boundary">Boundary</option>
        </select>
      </div>

      {value?.kind === "literal" && (
        <div className="mini-field">
          <span className="mini-label">Literal Text</span>
          <input aria-label="Literal value" value={value.value} onChange={(e) => onChange({ kind: "literal", value: e.target.value })} placeholder="value" />
        </div>
      )}

      {value?.kind === "variable" && (
        <div className="mini-field">
          <span className="mini-label">Variable Path</span>
          <input
            aria-label="Variable path"
            value={value.path}
            onChange={(e) => onChange({ kind: "variable", path: e.target.value })}
            placeholder="base_url / credentials.default.password"
            list="variable-suggestions"
          />
        </div>
      )}

      {value?.kind === "random" && (
        <>
          <div className="mini-field">
            <span className="mini-label">Generator</span>
            <select
              aria-label="Random data generator"
              value={value.generator}
              onChange={(e) => onChange({ ...value, generator: e.target.value as typeof value.generator })}
            >
              {RANDOM_GENERATORS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 4, textTransform: "none", fontWeight: 400, paddingBottom: 9 }}>
            <input
              type="checkbox"
              style={{ width: "auto" }}
              checked={value.seedOnce}
              onChange={(e) => onChange({ ...value, seedOnce: e.target.checked })}
            />
            Generate Once
          </label>
          <button type="button" onClick={() => onChange({ ...value, generatedValue: generateRandomValue(value.generator, value.pattern) })}>
            🎲 Preview
          </button>
          {value.generatedValue !== undefined && <span className="mono muted">{value.generatedValue}</span>}
        </>
      )}

      {value?.kind === "boundary" && (
        <>
          <div className="mini-field">
            <span className="mini-label">Boundary Case</span>
            <select
              aria-label="Boundary value case"
              value={value.boundary}
              onChange={(e) => onChange({ kind: "boundary", boundary: e.target.value as typeof value.boundary })}
            >
              {BOUNDARY_KINDS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
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
