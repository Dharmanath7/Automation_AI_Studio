import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type {
  ExecutionAdapter,
  ExecutionRequest,
  ExecutionResult,
  ExecutionEvent,
  NormalizedTestResult,
  RuntimeCheckResult,
  FailureClassification,
} from "./ExecutionAdapter";

function resolvePythonExecutable(projectDirectory: string): string {
  const venvPython = path.join(projectDirectory, ".venv", "Scripts", "python.exe");
  if (fs.existsSync(venvPython)) return venvPython;
  return "python";
}

function runCommand(exe: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { cwd, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => resolve({ stdout, stderr: stderr + String(err), code: -1 }));
    child.on("close", (code) => resolve({ stdout, stderr, code }));
  });
}

export function classifyFailure(message: string): FailureClassification {
  const m = message.toLowerCase();
  // Order matters: network/DNS failures must be checked before the auth
  // heuristic, and the auth heuristic must require an actual auth-failure
  // phrase — a bare "login" substring is too broad, since generated code
  // routinely names its own methods/files "login_flow" / "login_page.py"
  // regardless of why a test actually failed (caught via a real DNS
  // failure inside a login_flow() call being misclassified as "auth").
  if (m.includes("net::err") || m.includes("econnrefused") || m.includes("dns") || m.includes("name_not_resolved") || m.includes("connection")) {
    return "environment";
  }
  if (m.includes("timeout")) return "timeout";
  if (m.includes("strict mode violation") || m.includes("no element") || m.includes("resolved to 0 elements")) return "locator";
  if (m.includes("assertionerror") || m.includes("expect(")) return "assertion";
  if (
    m.includes("401") ||
    m.includes("unauthorized") ||
    m.includes("invalid credentials") ||
    m.includes("authentication failed") ||
    m.includes("login failed")
  ) {
    return "auth";
  }
  if (/\b(50\d|4\d\d)\b/.test(m) && (m.includes("http") || m.includes("api"))) return "api";
  if (m.includes("browser") || m.includes("playwright._impl")) return "browser";
  return "unknown";
}

export const PythonExecutionAdapter: ExecutionAdapter = {
  language: "python",

  async checkRuntime(projectDirectory: string): Promise<RuntimeCheckResult[]> {
    const python = resolvePythonExecutable(projectDirectory);
    const checks: RuntimeCheckResult[] = [];

    const pyVersion = await runCommand(python, ["--version"], projectDirectory);
    checks.push({
      tool: "Python",
      installed: pyVersion.code === 0,
      version: (pyVersion.stdout + pyVersion.stderr).trim() || undefined,
      details: pyVersion.code !== 0 ? "Python was not found. Install Python 3.10+ and ensure it is on PATH, or create a .venv in the project directory." : undefined,
    });

    const pytestVersion = await runCommand(python, ["-m", "pytest", "--version"], projectDirectory);
    checks.push({
      tool: "Pytest",
      installed: pytestVersion.code === 0,
      version: pytestVersion.stdout.trim() || undefined,
      details: pytestVersion.code !== 0 ? "Run: pip install -r requirements.txt" : undefined,
    });

    const playwrightVersion = await runCommand(python, ["-m", "playwright", "--version"], projectDirectory);
    checks.push({
      tool: "Playwright",
      installed: playwrightVersion.code === 0,
      version: playwrightVersion.stdout.trim() || undefined,
      details: playwrightVersion.code !== 0 ? "Run: pip install playwright && playwright install" : undefined,
    });

    // run() unconditionally passes --json-report and (for workers>1) -n to
    // pytest; without these plugins pytest fails at argument-parsing with a
    // generic "unrecognized arguments" error that gives no hint why. Check
    // for them explicitly so Runtime Manager can say what's actually missing
    // instead of the execution silently erroring later.
    const jsonReportCheck = await runCommand(python, ["-c", "import pytest_jsonreport"], projectDirectory);
    checks.push({
      tool: "pytest-json-report",
      installed: jsonReportCheck.code === 0,
      details: jsonReportCheck.code !== 0 ? "Required for parsing execution results. Run: pip install -r requirements.txt" : undefined,
    });

    const xdistCheck = await runCommand(python, ["-c", "import xdist"], projectDirectory);
    checks.push({
      tool: "pytest-xdist",
      installed: xdistCheck.code === 0,
      details: xdistCheck.code !== 0 ? "Required for parallel execution (Workers > 1). Run: pip install -r requirements.txt" : undefined,
    });

    return checks;
  },

  async run(request: ExecutionRequest, onEvent: (e: ExecutionEvent) => void): Promise<ExecutionResult> {
    const startedAt = new Date().toISOString();
    onEvent({ type: "started" });

    const python = resolvePythonExecutable(request.projectDirectory);
    fs.mkdirSync(request.artifactsDir, { recursive: true });
    const reportPath = path.join(request.artifactsDir, "report.json");
    const junitPath = path.join(request.artifactsDir, "junit.xml");

    const args = ["-m", "pytest"];
    if (request.testFilePaths.length > 0) {
      args.push(...request.testFilePaths);
    } else if (request.markerExpression) {
      args.push("-m", request.markerExpression);
    }
    if (request.workers > 1) args.push("--numprocesses", String(request.workers));
    args.push("--json-report", `--json-report-file=${reportPath}`);
    args.push("-o", "junit_family=xunit2", `--junitxml=${junitPath}`);

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      // Without this, Python defaults piped (non-console) stdout/stderr to
      // the OS codepage rather than UTF-8 on Windows — any non-ASCII
      // character written by pytest or a fixture (e.g. an em dash in an
      // error message) comes back through our stdout capture as a mangled
      // "�" instead of the real character. Caught in a real error message,
      // not by inspection.
      PYTHONIOENCODING: "utf-8",
      BASE_URL: request.env.base_url ?? "",
      API_URL: request.env.api_url ?? "",
      BROWSER: request.browser,
      HEADLESS: request.mode === "headless" ? "true" : "false",
      SCREENSHOT_STRATEGY: request.screenshotStrategy,
      ARTIFACTS_DIR: request.artifactsDir,
      AAS_CREDENTIALS_JSON: JSON.stringify(request.credentials),
    };
    for (const [key, value] of Object.entries(request.env)) {
      if (key === "base_url" || key === "api_url") continue;
      env[key.toUpperCase()] = value;
    }

    const child = spawn(python, args, { cwd: request.projectDirectory, shell: false, env });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      const chunk = d.toString();
      stdout += chunk;
      onEvent({ type: "log", stream: "stdout", chunk });
    });
    child.stderr?.on("data", (d) => {
      const chunk = d.toString();
      stderr += chunk;
      onEvent({ type: "log", stream: "stderr", chunk });
    });

    const exitCode: number | null = await new Promise((resolve) => {
      child.on("error", () => resolve(-1));
      child.on("close", (code) => resolve(code));
    });

    const finishedAt = new Date().toISOString();
    const durationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime();

    const tests: NormalizedTestResult[] = [];
    if (fs.existsSync(reportPath)) {
      try {
        const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
        for (const entry of report.tests ?? []) {
          const nodeId: string = entry.nodeid;
          const testFilePath = nodeId.split("::")[0];
          const status: NormalizedTestResult["status"] =
            entry.outcome === "passed" ? "passed" : entry.outcome === "skipped" ? "skipped" : entry.outcome === "failed" ? "failed" : "errored";
          const longrepr = entry.call?.longrepr ?? entry.setup?.longrepr;
          const errorMessage = longrepr ? String(longrepr) : undefined;

          const screenshotPath = path.join(
            request.artifactsDir,
            `${nodeId.split("::").slice(1).join("_")}_failure.png`
          );

          tests.push({
            testFilePath,
            nodeId,
            status,
            durationMs: Math.round((entry.call?.duration ?? entry.duration ?? 0) * 1000),
            errorMessage,
            failureClassification: errorMessage ? classifyFailure(errorMessage) : undefined,
            steps: [],
            artifacts: fs.existsSync(screenshotPath) ? [{ kind: "screenshot", path: screenshotPath }] : [],
          });
        }
      } catch (err) {
        stderr += `\n[Automation AI Studio] Failed to parse pytest-json-report output: ${String(err)}`;
      }
    }

    const anyFailed = tests.some((t) => t.status === "failed" || t.status === "errored");
    const allFailed = tests.length > 0 && tests.every((t) => t.status === "failed" || t.status === "errored");
    const status: ExecutionResult["status"] =
      tests.length === 0 && exitCode !== 0
        ? "errored"
        : allFailed
          ? "failed"
          : anyFailed
            ? "partially_failed"
            : "passed";

    const result: ExecutionResult = { status, startedAt, finishedAt, durationMs, tests, rawStdout: stdout, rawStderr: stderr, exitCode: exitCode ?? -1 };
    onEvent({ type: "finished", result });
    return result;
  },
};
