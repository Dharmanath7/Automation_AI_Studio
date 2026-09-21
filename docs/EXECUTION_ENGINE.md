# Execution Engine

## Interface

```ts
// app/electron/services/execution/ExecutionAdapter.ts
export interface ExecutionRequest {
  projectDirectory: string;
  testFilePaths: string[];      // relative paths, or [] to mean "whole suite marker"
  markerExpression?: string;    // e.g. "bvt", "smoke and not flaky"
  env: Record<string, string>;  // resolved base_url/api_url/custom_variables + BROWSER/HEADLESS flags
  credentials: Record<string, Record<string, string>>; // decrypted in-memory only, passed via temp env, never written to disk
  browser: "chromium" | "chrome" | "firefox" | "edge" | "webkit";
  mode: "headed" | "headless";
  workers: number;              // parallelism, default 1
  screenshotStrategy: "failureOnly" | "everyStep" | "disabled";
  videoEnabled: boolean;
  traceStrategy: "failureOnly" | "always" | "disabled";
  artifactsDir: string;         // where this adapter should tell the runner to write screenshots/video/trace
}

export interface NormalizedStepResult {
  stepId: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  screenshotArtifactPath?: string;
}

export interface NormalizedTestResult {
  testFilePath: string;
  testCaseId?: string;
  status: "passed" | "failed" | "skipped" | "errored";
  durationMs: number;
  errorMessage?: string;
  failedStepIndex?: number;
  steps: NormalizedStepResult[];
  artifacts: { kind: "screenshot" | "video" | "trace"; path: string; stepIndex?: number }[];
}

export interface ExecutionResult {
  status: "passed" | "failed" | "partially_failed" | "errored";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  tests: NormalizedTestResult[];
  rawStdout: string;
  rawStderr: string;
  exitCode: number;
}

export interface RuntimeCheckResult {
  tool: string;
  installed: boolean;
  version?: string;
  details?: string;
}

export interface ExecutionAdapter {
  readonly language: string;

  /** Runtime Manager support: what must be installed for this stack to run. */
  checkRuntime(projectDirectory: string): Promise<RuntimeCheckResult[]>;

  /** Build + launch the child process, capture output, parse results. Never throws on a normal test failure. */
  run(request: ExecutionRequest, onEvent: (e: ExecutionEvent) => void): Promise<ExecutionResult>;
}

export type ExecutionEvent =
  | { type: "started" }
  | { type: "testStarted"; testFilePath: string }
  | { type: "testFinished"; result: NormalizedTestResult }
  | { type: "log"; stream: "stdout" | "stderr"; chunk: string }
  | { type: "finished"; result: ExecutionResult };
```

`onEvent` is how the execution log streams live into the UI over IPC
(`execution:event` channel) instead of the renderer waiting for the whole run to
finish before showing anything.

## Phase 1 implementation: `PythonExecutionAdapter`

1. **`checkRuntime`**: runs `python --version`, `python -m pytest --version`,
   `python -m playwright --version` inside the project directory (respecting a
   project-local virtualenv if `<project_directory>/.venv` exists — Windows:
   `.venv\Scripts\python.exe`). Missing/failed checks are reported per-tool, not as
   one opaque failure, and surfaced in the Runtime Manager page (§44) with a
   user-friendly message plus expandable raw output.
2. **Command construction**:
   ```
   <python> -m pytest <testFilePaths or "-m <markerExpression>">
     --numprocesses <workers>     (pytest-xdist, only when workers > 1)
     --json-report --json-report-file=<artifactsDir>/report.json
     --browser <browser> --headed|<omit for headless>
     -o junit_family=xunit2 --junitxml=<artifactsDir>/junit.xml
   ```
   Environment variables passed to the child process (not written to any file):
   `BASE_URL`, `API_URL`, custom environment variables, and
   `AAS_CREDENTIALS_JSON` (a JSON blob of the decrypted profile, read by
   `conftest.py`'s `creds` fixture and immediately deleted from `os.environ` after
   being read into the fixture, so it doesn't leak into subprocess trees or crash
   dumps any longer than necessary).
3. **Screenshot/video/trace strategy** is translated into Playwright's own
   `conftest.py` fixture behavior (generated once per project — see
   `AUTOMATION_ADAPTERS.md`): `failureOnly` uses Playwright's
   `page.screenshot()` inside a `pytest_runtest_makereport` hook only on failure;
   `everyStep` is implemented by the generated Page Object methods calling a shared
   `maybe_screenshot(page, step_id)` helper after each action.
4. **Result parsing**: primary source is `report.json` (pytest-json-report), which
   gives per-test outcome/duration/longrepr; `junit.xml` is kept as a fallback/
   cross-check and for future CI export (`ROADMAP.md` Phase 6). Failure
   `longrepr` text is pattern-matched for a first-pass `failureClassification`
   (timeout strings → `timeout`; `AssertionError` → `assertion`; connection/DNS
   errors → `environment`; Playwright `strict mode violation` / "no element found" →
   `locator`; HTTP 4xx/5xx in captured network logs → `api`; everything else →
   `unknown`). This classification is always presented as a suggestion the user can
   correct, never as a final verdict (§36 of the product brief).
5. **Never throws on test failure.** A failed test is a normal, well-formed
   `ExecutionResult`; the adapter only rejects its promise for genuine infrastructure
   problems (venv missing, pytest itself crashed before collecting tests).

## Execution orchestration (caller side, not the adapter)

`services/execution/executionService.ts` owns the sequence the adapter doesn't know
about:
1. Resolve environment + credential profile → decrypt credentials in-memory only.
2. Create the `executions` row (`status: "running"`).
3. Call the adapter, forwarding `onEvent` into `execution_steps`/live IPC.
4. Persist `execution_tests`, `execution_steps`, `artifacts` from the normalized
   result.
5. Update `automation_mappings.last_execution_id`.
6. Zero out the in-memory decrypted credential object.

## Future adapters (interface only)

`JavaExecutionAdapter` (Maven/Gradle + JUnit/TestNG XML or Surefire reports),
`DotNetExecutionAdapter` (`dotnet test` + trx), `RobotExecutionAdapter`
(`robot` + `output.xml`) — same interface, same normalized `ExecutionResult`, so the
reporting dashboard and failure-detail view never need to know which stack ran.
