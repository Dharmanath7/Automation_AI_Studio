export interface ExecutionRequest {
  projectDirectory: string;
  testFilePaths: string[];
  markerExpression?: string;
  env: Record<string, string>;
  credentials: Record<string, Record<string, string>>;
  browser: "chromium" | "chrome" | "firefox" | "edge" | "webkit";
  mode: "headed" | "headless";
  workers: number;
  screenshotStrategy: "failureOnly" | "everyStep" | "disabled";
  videoEnabled: boolean;
  traceStrategy: "failureOnly" | "always" | "disabled";
  artifactsDir: string;
}

export interface NormalizedStepResult {
  stepId?: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  screenshotArtifactPath?: string;
}

export type FailureClassification =
  | "locator" | "assertion" | "application" | "api" | "auth"
  | "test_data" | "timeout" | "environment" | "browser" | "unknown";

export interface NormalizedTestResult {
  testFilePath: string;
  nodeId: string;
  status: "passed" | "failed" | "skipped" | "errored";
  durationMs: number;
  errorMessage?: string;
  failedStepIndex?: number;
  /** Plain-language description of the failed step (e.g. 'fill "Username" (role)'), read from the generated code's own "# STEP n: ..." marker comment at the traceback's failing line — reflects exactly what ran, not the (possibly since-edited) Test Model. */
  failedStepDescription?: string;
  failureClassification?: FailureClassification;
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

export type ExecutionEvent =
  | { type: "started" }
  | { type: "log"; stream: "stdout" | "stderr"; chunk: string }
  | { type: "finished"; result: ExecutionResult };

export interface ExecutionAdapter {
  readonly language: string;
  checkRuntime(projectDirectory: string): Promise<RuntimeCheckResult[]>;
  run(request: ExecutionRequest, onEvent: (e: ExecutionEvent) => void): Promise<ExecutionResult>;
}
