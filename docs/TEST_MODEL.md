# Framework-Neutral Test Model

This is the single object every test-creation path (recorder, manual builder, future
AI builder) writes to, and the only object every Code Generator Adapter reads from.
It is stored as JSON in `test_cases.test_model_json` (see `DATA_MODEL.md`).

## TypeScript type (source of truth: `app/electron/services/codegen/testModel.ts`)

```ts
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

export interface LocatorCandidate {
  strategy: "role" | "testId" | "label" | "placeholder" | "text" | "css" | "xpath";
  value: string;
  roleName?: string;       // accessible name, when strategy === "role"
  quality: "excellent" | "good" | "fair" | "fragile" | "avoid";
}

export interface StepTarget {
  preferred: LocatorCandidate;
  alternatives: LocatorCandidate[];
}

export type TestValue =
  | { kind: "literal"; value: string }
  | { kind: "variable"; path: string }        // e.g. "base_url", "credentials.default.password"
  | { kind: "random"; generator: RandomGenerator; seedOnce: boolean }
  | { kind: "boundary"; boundary: BoundaryKind };

export type RandomGenerator =
  | "firstName" | "lastName" | "fullName" | "email" | "phone" | "address"
  | "uuid" | "integer" | "decimal" | "alphanumeric" | "randomString"
  | "date" | "pastDate" | "futureDate" | "url" | "customPattern";

export type BoundaryKind =
  | "empty" | "whitespace" | "oneCharacter" | "maxLength" | "maxLengthPlusOne"
  | "specialCharacters" | "unicode" | "veryLongValue";

export type AssertionType =
  | "visible" | "hidden" | "enabled" | "disabled" | "checked" | "unchecked"
  | "textEquals" | "textContains" | "valueEquals" | "valueContains"
  | "attributeEquals" | "elementCount" | "urlEquals" | "urlContains"
  | "pageTitle" | "apiStatus" | "apiResponse" | "screenshotComparison";

export interface TestStep {
  id: string;                 // uuid, stable across edits/reorders
  type: StepType;
  target?: StepTarget;        // omitted for navigate/goBack/refresh/etc.
  value?: TestValue;
  assertion?: { type: AssertionType; expected?: TestValue; attribute?: string };
  flowRef?: { flowId: string };
  enabled: boolean;           // "Disable" without deleting
  note?: string;
  screenshotOnStep?: boolean; // per-step screenshot override
}

export interface TestModel {
  schemaVersion: 1;
  testCaseId: string;         // FK to test_cases.id
  name: string;
  projectId: string;
  tags: string[];             // e.g. ["bvt","smoke","regression"]
  steps: TestStep[];
}
```

## Design rules

1. **No raw secrets, ever.** A value that came from a `type="password"` field, or
   that the user explicitly marks as sourced from the Credential Vault, is always
   stored as `{ kind: "variable", path: "credentials.<profile>.<key>" }` — never as a
   literal. This is enforced at the point of recording (see `SECURITY.md` §3) and
   re-checked by the Test Review Assistant before save.
2. **No hardcoded environment URLs.** `navigate` steps use `{{base_url}}` /
   `{{api_url}}` style variables resolved from the selected `environment`, not literal
   `https://...tst-example.com` strings, so the same Test Model runs unmodified
   against TST, STG, or UAT.
3. **Locators carry alternatives, not just a final choice.** `StepTarget` stores the
   preferred locator plus alternatives with quality ratings, so the Element Inspector
   can display them and a future Locator Healing feature has candidates to suggest
   from — without needing to re-inspect the live page.
4. **Steps are addressable by stable id**, not array index, so execution results
   (`execution_steps`) and screenshots can reference a step even after later edits
   reorder the array.
5. **`flowRef` steps** reference a `reusable_flows` row and are expanded at
   generation time (inlined into the generated Page Object/test), not at edit time —
   so editing a flow updates every test that references it on next generation.
6. **Assertions are steps**, not a separate list, so they appear in-order in the
   visual editor and the execution timeline exactly where they run.

## Example (matches the product brief §4)

```json
{
  "schemaVersion": 1,
  "testCaseId": "test-case-uuid",
  "name": "Search Provider",
  "projectId": "project-001",
  "tags": ["bvt", "smoke", "regression"],
  "steps": [
    { "id": "s1", "type": "navigate", "value": { "kind": "variable", "path": "base_url" }, "enabled": true },
    { "id": "s2", "type": "fill",
      "target": { "preferred": { "strategy": "role", "value": "textbox", "roleName": "Username", "quality": "excellent" }, "alternatives": [] },
      "value": { "kind": "variable", "path": "credentials.default.username" }, "enabled": true },
    { "id": "s3", "type": "fill",
      "target": { "preferred": { "strategy": "role", "value": "textbox", "roleName": "Password", "quality": "excellent" }, "alternatives": [] },
      "value": { "kind": "variable", "path": "credentials.default.password" }, "enabled": true },
    { "id": "s4", "type": "click",
      "target": { "preferred": { "strategy": "role", "value": "button", "roleName": "Login", "quality": "excellent" }, "alternatives": [] },
      "enabled": true },
    { "id": "s5", "type": "assert", "assertion": { "type": "visible" },
      "target": { "preferred": { "strategy": "text", "value": "Dashboard", "quality": "good" }, "alternatives": [] },
      "enabled": true }
  ]
}
```

## Validation

`app/electron/services/codegen/testModel.ts` exports `validateTestModel(model)` used
in three places: before saving a test case, before generating code, and by the Test
Review Assistant (`ROADMAP.md` Phase 7). It rejects (not silently fixes):

- a `fill`/`select`/`check` step targeting a field whose recorded input type was
  `password` but whose value is `{ kind: "literal" }`
- a `navigate` step whose value is a literal absolute URL matching a known
  environment's `base_url` host (should be `{{base_url}}`)
- a step with no `target` where one is required for its `type`
- duplicate step `id`s
