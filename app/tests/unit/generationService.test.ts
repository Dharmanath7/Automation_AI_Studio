import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SqlJsDatabase } from "../../electron/db/sqlJsWrapper";
import { openDatabase } from "../../electron/db/connection";
import { createProject } from "../../electron/services/projectService";
import { createTestCase } from "../../electron/services/testCaseService";
import { writeGeneratedCode } from "../../electron/services/codegen/generationService";
import type { CodeGenerationResult } from "../../electron/services/codegen/adapters/CodeGeneratorAdapter";

let db: SqlJsDatabase;
let projectDir: string;

function resultWithConftest(conftestContent: string): CodeGenerationResult {
  return {
    testFile: { relativePath: "tests/uncategorized/test_t.py", content: "def test_t(): pass\n" },
    pageObjectFiles: [],
    supportFiles: [{ relativePath: "conftest.py", content: conftestContent }],
    testFilePath: "tests/uncategorized/test_t.py",
    pageObjectPaths: [],
    warnings: [],
  };
}

beforeEach(async () => {
  db = await openDatabase(":memory:");
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "aas-gen-test-"));
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

describe("writeGeneratedCode — support file (conftest.py etc.) upgrades", () => {
  it("creates a support file on first generation", () => {
    const project = createProject(db, { name: "P", code: `P${Date.now()}`, projectDirectory: projectDir });
    const testCase = createTestCase(db, { projectId: project.id, title: "T1" });

    const outcome = writeGeneratedCode(db, project, testCase.id, resultWithConftest("VERSION_1"));

    expect(outcome.conflicts).toEqual([]);
    expect(outcome.written).toContain("conftest.py");
    expect(fs.readFileSync(path.join(projectDir, "conftest.py"), "utf8")).toBe("VERSION_1");
  });

  it("silently upgrades an untouched support file when the generator's own template changes (the actual bug: conftest.py used to be create-once-never-touched, so a project generated before a template improvement — e.g. the smart-wait fixture — landed would run the stale version forever)", () => {
    const project = createProject(db, { name: "P", code: `P${Date.now()}`, projectDirectory: projectDir });
    const testCase = createTestCase(db, { projectId: project.id, title: "T1" });

    writeGeneratedCode(db, project, testCase.id, resultWithConftest("VERSION_1"));
    const outcome2 = writeGeneratedCode(db, project, testCase.id, resultWithConftest("VERSION_2"));

    expect(outcome2.conflicts).toEqual([]);
    expect(outcome2.written).toContain("conftest.py");
    expect(fs.readFileSync(path.join(projectDir, "conftest.py"), "utf8")).toBe("VERSION_2");
  });

  it("does not rewrite (and reports skippedUnchanged for) a support file whose content already matches the newly generated version", () => {
    const project = createProject(db, { name: "P", code: `P${Date.now()}`, projectDirectory: projectDir });
    const testCase = createTestCase(db, { projectId: project.id, title: "T1" });

    writeGeneratedCode(db, project, testCase.id, resultWithConftest("VERSION_1"));
    const outcome2 = writeGeneratedCode(db, project, testCase.id, resultWithConftest("VERSION_1"));

    expect(outcome2.written).not.toContain("conftest.py");
    expect(outcome2.skippedUnchanged).toContain("conftest.py");
  });

  it("reports a conflict (and does NOT overwrite) a support file the user has hand-edited since it was last generated", () => {
    const project = createProject(db, { name: "P", code: `P${Date.now()}`, projectDirectory: projectDir });
    const testCase = createTestCase(db, { projectId: project.id, title: "T1" });

    writeGeneratedCode(db, project, testCase.id, resultWithConftest("VERSION_1"));
    fs.writeFileSync(path.join(projectDir, "conftest.py"), "VERSION_1 + my custom fixture", "utf8");

    const outcome2 = writeGeneratedCode(db, project, testCase.id, resultWithConftest("VERSION_2"));

    expect(outcome2.conflicts).toHaveLength(1);
    expect(outcome2.conflicts[0].relativePath).toBe("conftest.py");
    expect(fs.readFileSync(path.join(projectDir, "conftest.py"), "utf8")).toBe("VERSION_1 + my custom fixture");
  });

  it("honors forcePaths to overwrite a conflicted support file with explicit user confirmation", () => {
    const project = createProject(db, { name: "P", code: `P${Date.now()}`, projectDirectory: projectDir });
    const testCase = createTestCase(db, { projectId: project.id, title: "T1" });

    writeGeneratedCode(db, project, testCase.id, resultWithConftest("VERSION_1"));
    fs.writeFileSync(path.join(projectDir, "conftest.py"), "VERSION_1 + my custom fixture", "utf8");

    const outcome2 = writeGeneratedCode(db, project, testCase.id, resultWithConftest("VERSION_2"), { forcePaths: ["conftest.py"] });

    expect(outcome2.conflicts).toEqual([]);
    expect(fs.readFileSync(path.join(projectDir, "conftest.py"), "utf8")).toBe("VERSION_2");
  });

  it("upgrades (with a warning, not a conflict) a support file that already existed on disk before this project ever tracked a support-file hash — the exact migration case for projects generated before this fix shipped", () => {
    const project = createProject(db, { name: "P", code: `P${Date.now()}`, projectDirectory: projectDir });
    const testCase = createTestCase(db, { projectId: project.id, title: "T1" });

    // Simulates a pre-existing project: conftest.py already on disk, but
    // this project's automation_support_file_hashes setting has never been
    // written (no prior writeGeneratedCode call at all).
    fs.writeFileSync(path.join(projectDir, "conftest.py"), "OLD_STALE_VERSION_NO_SMART_WAITS", "utf8");

    const outcome = writeGeneratedCode(db, project, testCase.id, resultWithConftest("VERSION_WITH_SMART_WAITS"));

    expect(outcome.conflicts).toEqual([]);
    expect(outcome.written).toContain("conftest.py");
    expect(fs.readFileSync(path.join(projectDir, "conftest.py"), "utf8")).toBe("VERSION_WITH_SMART_WAITS");
    expect(outcome.warnings.some((w) => w.includes("conftest.py"))).toBe(true);
  });

  it("tracks support-file hashes per project, not per test case, so generating a DIFFERENT test case in the same project still recognizes the support file as unchanged", () => {
    const project = createProject(db, { name: "P", code: `P${Date.now()}`, projectDirectory: projectDir });
    const testCaseA = createTestCase(db, { projectId: project.id, title: "TA" });
    const testCaseB = createTestCase(db, { projectId: project.id, title: "TB" });

    writeGeneratedCode(db, project, testCaseA.id, resultWithConftest("VERSION_1"));
    const outcomeB = writeGeneratedCode(db, project, testCaseB.id, resultWithConftest("VERSION_1"));

    // If hash-tracking were incorrectly scoped per-test-case, testCaseB's
    // codegen would have no prior hash on record and would treat the
    // (identical, untouched) file as new/changed rather than unchanged.
    expect(outcomeB.skippedUnchanged).toContain("conftest.py");
    expect(outcomeB.written).not.toContain("conftest.py");
  });
});
