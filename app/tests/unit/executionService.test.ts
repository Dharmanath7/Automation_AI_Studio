import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SqlJsDatabase } from "../../electron/db/sqlJsWrapper";
import { openDatabase } from "../../electron/db/connection";
import { createProject } from "../../electron/services/projectService";
import { createEnvironment } from "../../electron/services/environmentService";
import { createTestCase, saveTestModel, getTestCase } from "../../electron/services/testCaseService";
import { ensureBootstrapAdmin } from "../../electron/services/authService";
import type { ExecutionResult } from "../../electron/services/execution/ExecutionAdapter";

const fakeResult: ExecutionResult = {
  status: "passed",
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  durationMs: 1,
  tests: [],
  rawStdout: "",
  rawStderr: "",
  exitCode: 0,
};

const runMock = vi.fn(async () => fakeResult);

vi.mock("../../electron/services/execution/PythonExecutionAdapter", () => ({
  PythonExecutionAdapter: { run: (...args: unknown[]) => runMock(...args) },
}));

vi.mock("electron", () => ({
  app: { getPath: () => os.tmpdir() },
}));

let db: SqlJsDatabase;
let projectDir: string;
let userId: string;

beforeEach(async () => {
  runMock.mockClear();
  db = await openDatabase(":memory:");
  await ensureBootstrapAdmin(db);
  userId = (db.prepare("SELECT id FROM users LIMIT 1").get() as { id: string }).id;
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "aas-exec-test-"));
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

function fillStepModel(value: string, kind: "literal" | "random" = "literal") {
  return {
    steps: [
      { id: "s1", type: "navigate" as const, value: { kind: "variable" as const, path: "base_url" }, enabled: true },
      {
        id: "s2",
        type: "fill" as const,
        target: { preferred: { strategy: "role" as const, value: "textbox", roleName: "Username", quality: "excellent" as const }, alternatives: [] },
        value:
          kind === "literal"
            ? { kind: "literal" as const, value }
            : { kind: "random" as const, generator: "randomString" as const, seedOnce: false },
        enabled: true,
      },
    ],
  };
}

describe("runExecution — regenerates code from the current test model before running (regression: edited steps, e.g. a random-value config, weren't picked up by Run)", () => {
  it("runs the test case's LATEST saved model, not whatever was generated the last time 'Generate Code' was clicked", async () => {
    const { runExecution } = await import("../../electron/services/execution/executionService");

    const project = createProject(db, { name: "P", code: `P${Date.now()}`, projectDirectory: projectDir });
    const environment = createEnvironment(db, { projectId: project.id, name: "E", baseUrl: "https://example.com" });
    let tc = createTestCase(db, { projectId: project.id, title: "Edited Test" });
    tc = saveTestModel(db, tc.id, { ...tc.testModel, ...fillStepModel("OldLiteralValue") }, []);

    await runExecution(db, {
      projectId: project.id,
      environmentId: environment.id,
      testCaseIds: [tc.id],
      triggerType: "single",
      browser: "chromium",
      mode: "headless",
      triggeredByUserId: userId,
    });
    const pageObjectPath = path.join(projectDir, "pages", "edited_test_page.py");
    expect(fs.readFileSync(pageObjectPath, "utf8")).toContain("OldLiteralValue");

    // Edit the step — e.g. switching a field from a literal value to a
    // random one, exactly the reported scenario — WITHOUT calling
    // "Generate Code" again, and run a second time.
    tc = getTestCase(db, tc.id)!;
    saveTestModel(db, tc.id, { ...tc.testModel, ...fillStepModel("", "random") }, []);

    await runExecution(db, {
      projectId: project.id,
      environmentId: environment.id,
      testCaseIds: [tc.id],
      triggerType: "single",
      browser: "chromium",
      mode: "headless",
      triggeredByUserId: userId,
    });

    const updatedContent = fs.readFileSync(pageObjectPath, "utf8");
    expect(updatedContent).not.toContain("OldLiteralValue");
    expect(updatedContent).toContain("random_data.random_string()");
  });

  it("does not clobber a page object the user hand-edited outside the Studio, and still runs it", async () => {
    const { runExecution } = await import("../../electron/services/execution/executionService");

    const project = createProject(db, { name: "P", code: `P${Date.now()}`, projectDirectory: projectDir });
    const environment = createEnvironment(db, { projectId: project.id, name: "E", baseUrl: "https://example.com" });
    let tc = createTestCase(db, { projectId: project.id, title: "Hand Edited" });
    tc = saveTestModel(db, tc.id, { ...tc.testModel, ...fillStepModel("Original") }, []);

    await runExecution(db, {
      projectId: project.id,
      environmentId: environment.id,
      testCaseIds: [tc.id],
      triggerType: "single",
      browser: "chromium",
      mode: "headless",
      triggeredByUserId: userId,
    });

    const pageObjectPath = path.join(projectDir, "pages", "hand_edited_page.py");
    fs.writeFileSync(pageObjectPath, "# hand-customized by the user\n" + fs.readFileSync(pageObjectPath, "utf8"), "utf8");

    tc = getTestCase(db, tc.id)!;
    saveTestModel(db, tc.id, { ...tc.testModel, ...fillStepModel("NewValue") }, []);

    const events: { type: string; chunk?: string }[] = [];
    await runExecution(
      db,
      {
        projectId: project.id,
        environmentId: environment.id,
        testCaseIds: [tc.id],
        triggerType: "single",
        browser: "chromium",
        mode: "headless",
        triggeredByUserId: userId,
      },
      (e) => events.push(e as { type: string; chunk?: string })
    );

    const finalContent = fs.readFileSync(pageObjectPath, "utf8");
    expect(finalContent).toContain("# hand-customized by the user");
    expect(finalContent).not.toContain("NewValue");
    expect(events.some((e) => e.type === "log" && e.chunk?.includes("edited outside the Studio"))).toBe(true);
    expect(runMock).toHaveBeenCalled();
  });
});
