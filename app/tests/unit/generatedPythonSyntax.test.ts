import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PlaywrightPythonPytestGenerator } from "../../electron/services/codegen/adapters/PlaywrightPythonPytestGenerator";
import type { TestModel } from "../../electron/shared/testModel";

/**
 * Every other generator test checks the STRING content of generated Python
 * (toContain / toMatch) — none of them actually parse it. That's exactly how
 * a quote-escaping bug in the conftest.py template (a literal `"..."` used
 * inside an already double-quoted f-string, producing invalid Python) shipped
 * undetected: the string content looked right, the file didn't parse. This
 * compiles every generated file with the real Python interpreter.
 */
let pythonAvailable = false;

beforeAll(() => {
  try {
    execFileSync("python", ["--version"], { stdio: "ignore" });
    pythonAvailable = true;
  } catch {
    pythonAvailable = false;
  }
});

function compileCheck(filePath: string): void {
  execFileSync("python", ["-m", "py_compile", filePath], { stdio: "pipe" });
}

const model: TestModel = {
  schemaVersion: 1,
  testCaseId: "tc-1",
  projectId: "proj-1",
  name: "Health Plan Create DEMO1",
  tags: ["bvt", "smoke", "regression"],
  steps: [
    { id: "s1", type: "navigate", value: { kind: "variable", path: "base_url" }, enabled: true },
    {
      id: "s2",
      type: "fill",
      target: { preferred: { strategy: "role", value: "textbox", roleName: "Username", quality: "excellent" }, alternatives: [] },
      value: { kind: "variable", path: "credentials.default.username" },
      enabled: true,
    },
    {
      id: "s3",
      type: "fill",
      target: { preferred: { strategy: "role", value: "textbox", roleName: "Password", quality: "excellent" }, alternatives: [] },
      value: { kind: "variable", path: "credentials.default.password" },
      enabled: true,
    },
    {
      id: "s4",
      type: "click",
      target: { preferred: { strategy: "role", value: "button", roleName: "Login", quality: "excellent" }, alternatives: [] },
      enabled: true,
    },
    {
      id: "s5",
      type: "assert",
      target: { preferred: { strategy: "text", value: "Dashboard", quality: "good" }, alternatives: [] },
      assertion: { type: "visible" },
      enabled: true,
    },
  ],
};

describe("Generated Python actually parses (not just looks right as a string)", () => {
  it("every generated file compiles with the real Python interpreter", () => {
    if (!pythonAvailable) {
      console.warn("Skipping: no `python` on PATH in this environment.");
      return;
    }

    const ctx = { projectDirectory: "C:/proj", projectCode: "PROJ", existingPageObjectNames: [] };
    const result = PlaywrightPythonPytestGenerator.generate(model, ctx);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aas-pysyntax-"));
    try {
      const allFiles = [result.testFile, ...result.pageObjectFiles, ...result.supportFiles];
      for (const file of allFiles) {
        if (!file.relativePath.endsWith(".py")) continue;
        const target = path.join(tmpDir, path.basename(file.relativePath));
        fs.writeFileSync(target, file.content, "utf8");
        expect(() => compileCheck(target), `${file.relativePath} failed to compile`).not.toThrow();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
