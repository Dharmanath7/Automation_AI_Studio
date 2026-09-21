import { describe, it, expect } from "vitest";
import { PlaywrightPythonPytestGenerator } from "../../electron/services/codegen/adapters/PlaywrightPythonPytestGenerator";
import type { TestModel } from "../../electron/shared/testModel";

const model: TestModel = {
  schemaVersion: 1,
  testCaseId: "tc-1",
  projectId: "proj-1",
  name: "Search Provider",
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

describe("PlaywrightPythonPytestGenerator", () => {
  const ctx = { projectDirectory: "C:/proj", projectCode: "PROJ", existingPageObjectNames: [] };
  const result = PlaywrightPythonPytestGenerator.generate(model, ctx);

  it("writes the test file into the bvt suite folder (highest priority tag)", () => {
    expect(result.testFilePath).toBe("tests/bvt/test_search_provider.py");
  });

  it("registers all three suite markers", () => {
    expect(result.testFile.content).toContain("@pytest.mark.bvt");
    expect(result.testFile.content).toContain("@pytest.mark.smoke");
    expect(result.testFile.content).toContain("@pytest.mark.regression");
  });

  it("imports and instantiates the generated Page Object", () => {
    expect(result.testFile.content).toContain("from pages.search_provider_page import SearchProviderPage");
    expect(result.testFile.content).toContain("SearchProviderPage(page)");
  });

  it("groups the login fields into a login flow method, not a literal password", () => {
    const page = result.pageObjectFiles[0].content;
    expect(page).toMatch(/def login_flow\(/);
    expect(page).toContain('creds["default"]["password"]');
    expect(page).not.toContain("hunter2");
  });

  it("resolves the navigate step through env[\"base_url\"], never a literal URL", () => {
    expect(result.pageObjectFiles[0].content).toContain('env["base_url"]');
  });

  it("renders the visible assertion using Playwright's auto-retrying expect()", () => {
    expect(result.pageObjectFiles[0].content).toMatch(/expect\(self\.\w+\)\.to_be_visible\(\)/);
  });

  it("produces support files including conftest.py and requirements.txt", () => {
    const paths = result.supportFiles.map((f) => f.relativePath);
    expect(paths).toContain("conftest.py");
    expect(paths).toContain("requirements.txt");
    expect(paths).toContain("pytest.ini");
  });

  it("never lets a method name collide with a locator attribute name (regression: 'Login' button + login() method)", () => {
    // Both the "Login" button's locator attribute and the login-flow method
    // name derive from the word "login". If they ever collide, the instance
    // attribute set in __init__ silently shadows the method and calling it
    // raises "'Locator' object is not callable" at runtime — caught via a
    // real `pytest` run against generated output, not just static review.
    const page = result.pageObjectFiles[0].content;
    expect(page).toContain("self.login = page.get_by_role");
    expect(page).not.toMatch(/def login\(/);
    expect(page).toMatch(/def login_flow\(/);
    expect(result.testFile.content).toContain("search_provider_page.login_flow(env, creds)");
  });
});
