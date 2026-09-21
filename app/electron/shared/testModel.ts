/**
 * Framework-neutral Test Model. Pure types + validation only — no Node/Electron
 * APIs — so this module is safe to import from both the Electron main process
 * and the React renderer (via `import type` / value imports of pure functions).
 * See docs/TEST_MODEL.md for the full design rationale.
 */

export type StepType =
  | "navigate"
  | "click"
  | "doubleClick"
  | "fill"
  | "clear"
  | "select"
  | "check"
  | "uncheck"
  | "hover"
  | "pressKey"
  | "upload"
  | "download"
  | "newTab"
  | "closeTab"
  | "goBack"
  | "goForward"
  | "refresh"
  | "dragAndDrop"
  | "scroll"
  | "assert"
  | "flowRef";

export const STEP_TYPES: StepType[] = [
  "navigate", "click", "doubleClick", "fill", "clear", "select", "check", "uncheck",
  "hover", "pressKey", "upload", "download", "newTab", "closeTab", "goBack",
  "goForward", "refresh", "dragAndDrop", "scroll", "assert", "flowRef",
];

export type LocatorStrategy = "role" | "testId" | "label" | "placeholder" | "text" | "css" | "xpath";
export type LocatorQuality = "excellent" | "good" | "fair" | "fragile" | "avoid";

export interface LocatorCandidate {
  strategy: LocatorStrategy;
  value: string;
  roleName?: string;
  quality: LocatorQuality;
}

export interface StepTarget {
  preferred: LocatorCandidate;
  alternatives: LocatorCandidate[];
}

export type RandomGenerator =
  | "firstName" | "lastName" | "fullName" | "email" | "phone" | "address"
  | "uuid" | "integer" | "decimal" | "alphanumeric" | "randomString"
  | "date" | "pastDate" | "futureDate" | "url" | "customPattern";

export const RANDOM_GENERATORS: RandomGenerator[] = [
  "firstName", "lastName", "fullName", "email", "phone", "address", "uuid",
  "integer", "decimal", "alphanumeric", "randomString", "date", "pastDate",
  "futureDate", "url", "customPattern",
];

export type BoundaryKind =
  | "empty" | "whitespace" | "oneCharacter" | "maxLength" | "maxLengthPlusOne"
  | "specialCharacters" | "unicode" | "veryLongValue";

export const BOUNDARY_KINDS: BoundaryKind[] = [
  "empty", "whitespace", "oneCharacter", "maxLength", "maxLengthPlusOne",
  "specialCharacters", "unicode", "veryLongValue",
];

export type TestValue =
  | { kind: "literal"; value: string }
  | { kind: "variable"; path: string }
  | { kind: "random"; generator: RandomGenerator; seedOnce: boolean; pattern?: string; generatedValue?: string }
  | { kind: "boundary"; boundary: BoundaryKind };

export type AssertionType =
  | "visible" | "hidden" | "enabled" | "disabled" | "checked" | "unchecked"
  | "textEquals" | "textContains" | "valueEquals" | "valueContains"
  | "attributeEquals" | "elementCount" | "urlEquals" | "urlContains"
  | "pageTitle" | "apiStatus" | "apiResponse" | "screenshotComparison";

export const ASSERTION_TYPES: AssertionType[] = [
  "visible", "hidden", "enabled", "disabled", "checked", "unchecked",
  "textEquals", "textContains", "valueEquals", "valueContains",
  "attributeEquals", "elementCount", "urlEquals", "urlContains",
  "pageTitle", "apiStatus", "apiResponse", "screenshotComparison",
];

export interface Assertion {
  type: AssertionType;
  expected?: TestValue;
  attribute?: string;
}

export interface TestStep {
  id: string;
  type: StepType;
  target?: StepTarget;
  value?: TestValue;
  assertion?: Assertion;
  flowRef?: { flowId: string };
  enabled: boolean;
  note?: string;
  screenshotOnStep?: boolean;
}

export interface TestModel {
  schemaVersion: 1;
  testCaseId: string;
  name: string;
  projectId: string;
  tags: string[];
  steps: TestStep[];
}

export const STEPS_REQUIRING_TARGET: StepType[] = [
  "click", "doubleClick", "fill", "clear", "select", "check", "uncheck",
  "hover", "upload", "dragAndDrop", "assert",
];

export interface ValidationIssue {
  stepId?: string;
  message: string;
}

/**
 * Rejects Test Models with unsafe or structurally invalid content — never
 * silently "fixes" them. See docs/TEST_MODEL.md "Validation".
 */
export function validateTestModel(model: TestModel, knownBaseUrls: string[] = []): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenIds = new Set<string>();

  if (!model.name.trim()) issues.push({ message: "Test name is required." });
  if (model.steps.length === 0) issues.push({ message: "A test must have at least one step." });

  for (const step of model.steps) {
    if (seenIds.has(step.id)) {
      issues.push({ stepId: step.id, message: `Duplicate step id "${step.id}".` });
    }
    seenIds.add(step.id);

    if (STEPS_REQUIRING_TARGET.includes(step.type) && !step.target) {
      issues.push({ stepId: step.id, message: `Step type "${step.type}" requires a target locator.` });
    }

    if (step.type === "navigate" && step.value?.kind === "literal") {
      const literal = step.value.value;
      if (knownBaseUrls.some((base) => literal.startsWith(base))) {
        issues.push({
          stepId: step.id,
          message: "Navigate step uses a hardcoded environment URL — use {{base_url}} instead.",
        });
      }
    }

    if (
      step.target?.preferred.roleName &&
      /password/i.test(step.target.preferred.roleName) &&
      step.value?.kind === "literal"
    ) {
      issues.push({
        stepId: step.id,
        message: "A password field must reference a Credential Vault variable, not a literal value.",
      });
    }
  }

  return issues;
}

export function createEmptyTestModel(input: { testCaseId: string; projectId: string; name: string }): TestModel {
  return {
    schemaVersion: 1,
    testCaseId: input.testCaseId,
    projectId: input.projectId,
    name: input.name,
    tags: [],
    steps: [],
  };
}
