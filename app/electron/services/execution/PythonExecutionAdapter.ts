import { spawn, execFile } from "node:child_process";
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

/**
 * Kills a process and its whole descendant tree — plain child.kill() on
 * Windows only signals the immediate pytest/python.exe process, not the
 * Playwright driver or browser processes it spawned, which is exactly the
 * "the browser doesn't close on its own" failure mode: something downstream
 * (most commonly an unhandled dialog — see the generated conftest.py's page
 * fixture) hangs test teardown, pytest itself never exits, and without this
 * the run would sit there forever rather than being reported as a clear,
 * actionable timeout.
 */
function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(pid), "/T", "/F"], () => {});
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Process likely already gone — nothing further to do.
      }
    }
  }
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
  // An explicit exception CLASS NAME is a far more reliable signal than any
  // loose keyword search below, and is checked first for exactly that
  // reason: a full pytest traceback for a plain Locator.fill() timeout
  // passes through several of Playwright's own internal frames on its way
  // to raising TimeoutError — including playwright._impl._connection —
  // so a bare `.includes("connection")` check (previously below) matched
  // every single one of those, misclassifying it as "environment" instead
  // of "timeout". Caught via a real run, not by inspection.
  if (m.includes("timeouterror") || m.includes("timeout_error")) return "timeout";

  // Order matters below too: network/DNS failures must be checked before
  // the auth heuristic, and the auth heuristic must require an actual
  // auth-failure phrase — a bare "login" substring is too broad, since
  // generated code routinely names its own methods/files "login_flow" /
  // "login_page.py" regardless of why a test actually failed (caught via a
  // real DNS failure inside a login_flow() call being misclassified as
  // "auth"). The connection-failure check requires an actual failure
  // phrase ("connection refused/reset/...") for the same reason
  // TimeoutError is now checked first — a bare "connection" substring is
  // too broad; it matches Playwright's own module/class names in every
  // traceback regardless of what actually failed.
  if (
    m.includes("net::err") ||
    m.includes("econnrefused") ||
    m.includes("name_not_resolved") ||
    m.includes("dns_probe") ||
    /\bconnection (refused|reset|timed ?out|aborted)\b/.test(m)
  ) {
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

/**
 * Traces a failure's pytest traceback back to the specific recorded/manual
 * step that failed, by finding the deepest frame inside our own generated
 * page object (not Playwright's own library code) and reading that exact
 * source line's nearest preceding "# STEP n: ..." marker comment (emitted
 * by PlaywrightPythonPytestGenerator.ts for exactly this purpose). Reads
 * the marker from the file that actually ran, not the Test Model, since the
 * Test Model may have been edited since — see WHERE the test case fails,
 * which is often the harder half of "why did this fail" to answer from a
 * raw Python traceback alone.
 */
export function locateFailingStep(
  errorMessage: string,
  projectDirectory: string
): { stepIndex: number; description: string } | null {
  const frameMatch = errorMessage.match(/([^\s:"']*_page\.py):(\d+): in \w+/);
  if (!frameMatch) return null;
  const [, relPath, lineStr] = frameMatch;
  const lineNum = parseInt(lineStr, 10);
  const projectRoot = path.resolve(projectDirectory);
  const absPath = path.resolve(projectRoot, relPath);
  if (absPath !== projectRoot && !absPath.startsWith(projectRoot + path.sep)) return null; // never read outside the project

  let content: string;
  try {
    content = fs.readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
  const lines = content.split(/\r?\n/);
  for (let i = Math.min(lineNum - 1, lines.length - 1); i >= 0; i--) {
    const m = lines[i].match(/^\s*# STEP (\d+): (.+)$/);
    if (m) return { stepIndex: parseInt(m[1], 10), description: m[2] };
  }
  return null;
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

    // A hard ceiling on the whole run, independent of Playwright's own
    // per-action timeout (env.timeout_ms) — that budget only ever applies to
    // individual actions/assertions, so it does nothing to bound a process
    // that's hanging somewhere else entirely (teardown, an unhandled
    // dialog, a wedged browser process). Without this, that kind of hang
    // blocks the run forever instead of failing cleanly, and — for a suite
    // — blocks every test queued after it too, since pytest itself never
    // reaches them. 3 minutes/test is generous for headed runs against a
    // real, possibly slow, application; overridable for unusual cases.
    const timeoutMs = Number(process.env.AAS_EXECUTION_TIMEOUT_MS) || Math.max(180_000, request.testFilePaths.length * 180_000);
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      const msg = `\n[Automation AI Studio] Execution exceeded its ${Math.round(timeoutMs / 1000)}s timeout and was terminated — the browser or test process did not finish/close on its own (a common cause is an unhandled dialog blocking teardown). Increase AAS_EXECUTION_TIMEOUT_MS if this test genuinely needs more time.\n`;
      stderr += msg;
      onEvent({ type: "log", stream: "stderr", chunk: msg });
      if (child.pid) killProcessTree(child.pid);
    }, timeoutMs);

    const exitCode: number | null = await new Promise((resolve) => {
      child.on("error", () => resolve(-1));
      child.on("close", (code) => resolve(code));
    });
    clearTimeout(timeoutHandle);

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

          const failedStep = errorMessage ? locateFailingStep(errorMessage, request.projectDirectory) : null;

          tests.push({
            testFilePath,
            nodeId,
            status,
            durationMs: Math.round((entry.call?.duration ?? entry.duration ?? 0) * 1000),
            errorMessage,
            failedStepIndex: failedStep?.stepIndex,
            failedStepDescription: failedStep?.description,
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
      timedOut || (tests.length === 0 && exitCode !== 0)
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
