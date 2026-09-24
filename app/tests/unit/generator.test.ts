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

  it("never lets a flow method collide with a locator property name (regression: 'Login' button + login() method)", () => {
    // Both the "Login" button's locator property and the login-flow method
    // name derive from the word "login". If they ever collided under the
    // old __init__-attribute-binding design, the instance attribute set in
    // __init__ would silently shadow the method and calling it would raise
    // "'Locator' object is not callable" at runtime — caught via a real
    // `pytest` run against generated output, not just static review.
    // Locators are now @property methods (see the tab-switch note below),
    // which sidesteps that specific failure mode, but the flow method must
    // still be named distinctly from the locator property.
    const page = result.pageObjectFiles[0].content;
    expect(page).toContain("def login(self) -> Locator:");
    expect(page).not.toMatch(/def login\(self, env/);
    expect(page).toMatch(/def login_flow\(/);
    expect(result.testFile.content).toContain("search_provider_page.login_flow(env, creds)");
  });
});

describe("PlaywrightPythonPytestGenerator — smart waits", () => {
  const ctx = { projectDirectory: "C:/proj", projectCode: "PROJ", existingPageObjectNames: [] };

  it("waits for load state after a click, in case it triggered a navigation", () => {
    const clickModel: TestModel = {
      schemaVersion: 1,
      testCaseId: "tc-2",
      projectId: "proj-1",
      name: "Click Through",
      tags: [],
      steps: [
        {
          id: "c1",
          type: "click",
          target: { preferred: { strategy: "role", value: "link", roleName: "Provider Search", quality: "excellent" }, alternatives: [] },
          enabled: true,
        },
      ],
    };
    const result = PlaywrightPythonPytestGenerator.generate(clickModel, ctx);
    const page = result.pageObjectFiles[0].content;
    expect(page).toMatch(/\.click\(\)\s*\n\s*self\.page\.wait_for_load_state\("domcontentloaded"\)/);
  });

  it("wires the environment's configurable timeout into both action and assertion (expect) waits", () => {
    const result = PlaywrightPythonPytestGenerator.generate(model, ctx);
    const conftest = result.supportFiles.find((f) => f.relativePath === "conftest.py")!.content;
    expect(conftest).toContain('int(os.environ.get("TIMEOUT_MS", "30000"))');
    expect(conftest).toContain("expect.set_options(timeout=env[\"timeout_ms\"])");
    expect(conftest).toContain('context.set_default_timeout(env["timeout_ms"])');
  });
});

describe("PlaywrightPythonPytestGenerator — tab switching", () => {
  const ctx = { projectDirectory: "C:/proj", projectCode: "PROJ", existingPageObjectNames: [] };

  // Mirrors exactly what the recorder emits when a click opens a new
  // browser tab — see electron/services/recorder/recorderService.ts, which
  // records a "newTab" step immediately after the triggering click.
  const tabModel: TestModel = {
    schemaVersion: 1,
    testCaseId: "tc-3",
    projectId: "proj-1",
    name: "Open External Link",
    tags: [],
    steps: [
      {
        id: "t1",
        type: "click",
        target: { preferred: { strategy: "role", value: "link", roleName: "View Details", quality: "excellent" }, alternatives: [] },
        enabled: true,
      },
      { id: "t2", type: "newTab", enabled: true },
      {
        id: "t3",
        type: "assert",
        target: { preferred: { strategy: "text", value: "Details Page", quality: "good" }, alternatives: [] },
        assertion: { type: "visible" },
        enabled: true,
      },
    ],
  };

  it("wraps the tab-opening click in context.expect_page() and reassigns self.page", () => {
    const result = PlaywrightPythonPytestGenerator.generate(tabModel, ctx);
    const page = result.pageObjectFiles[0].content;
    expect(page).toContain("with self.page.context.expect_page() as new_page_info:");
    expect(page).toContain("self.page = new_page_info.value");
    // The newTab step itself must not generate a separate/duplicate statement.
    expect(page).not.toMatch(/TODO.*newTab/);
  });

  it("generates locators as @property methods (not __init__ attributes) so they resolve against the current self.page after a tab switch", () => {
    const result = PlaywrightPythonPytestGenerator.generate(tabModel, ctx);
    const page = result.pageObjectFiles[0].content;
    expect(page).toMatch(/@property\s*\n\s*def view_details\(self\) -> Locator:\s*\n\s*return self\.page\.get_by_role/);
    // The old design bound locators once in __init__ against whatever page
    // was passed at construction time; that would silently keep querying
    // the pre-tab-switch page instead of the new tab.
    expect(page).not.toContain("self.view_details = ");
  });
});

describe("PlaywrightPythonPytestGenerator — random value regeneration", () => {
  const ctx = { projectDirectory: "C:/proj", projectCode: "PROJ", existingPageObjectNames: [] };

  function modelWithRandomFill(value: TestModel["steps"][number]["value"]): TestModel {
    return {
      schemaVersion: 1,
      testCaseId: "tc-random",
      projectId: "proj-1",
      name: "Create Account",
      tags: [],
      steps: [
        { id: "r1", type: "navigate", value: { kind: "variable", path: "base_url" }, enabled: true },
        {
          id: "r2",
          type: "fill",
          target: { preferred: { strategy: "role", value: "textbox", roleName: "Username", quality: "excellent" }, alternatives: [] },
          value,
          enabled: true,
        },
      ],
    };
  }

  it("regression: seedOnce=false (the UI default) emits a runtime random_data call, never a baked literal, so every test run gets a fresh value", () => {
    // This is the root-cause fix for the user report: "the random value...
    // should add the random value in every test case iteration, not only
    // once." A baked-in literal here would make every execution reuse the
    // exact same "random" value forever.
    const model = modelWithRandomFill({ kind: "random", generator: "randomString", seedOnce: false, generatedValue: "preview-abc123" });
    const result = PlaywrightPythonPytestGenerator.generate(model, ctx);
    const page = result.pageObjectFiles[0].content;
    expect(page).toContain("random_data.random_string()");
    expect(page).not.toContain("preview-abc123");
  });

  it("seedOnce=true bakes the locked-in generatedValue as a literal, for the explicit opt-in 'same value every run' case", () => {
    const model = modelWithRandomFill({ kind: "random", generator: "email", seedOnce: true, generatedValue: "locked@example.com" });
    const result = PlaywrightPythonPytestGenerator.generate(model, ctx);
    const page = result.pageObjectFiles[0].content;
    expect(page).toContain('"locked@example.com"');
    expect(page).not.toContain("random_data.email()");
  });

  it("seedOnce=true with no generatedValue yet falls back to a runtime call (nothing to bake in)", () => {
    const model = modelWithRandomFill({ kind: "random", generator: "uuid", seedOnce: true });
    const result = PlaywrightPythonPytestGenerator.generate(model, ctx);
    const page = result.pageObjectFiles[0].content;
    expect(page).toContain("random_data.uuid()");
  });
});

describe("PlaywrightPythonPytestGenerator — hover steps", () => {
  const ctx = { projectDirectory: "C:/proj", projectCode: "PROJ", existingPageObjectNames: [] };

  it("generates a real .hover() call for a recorded hover step (the recorder's own CSS-:hover-rule detection was separately broken by a template-literal escaping bug — see pageScript.test.ts — but the code generator's own hover handling was correct throughout, so this pins that down explicitly)", () => {
    const model: TestModel = {
      schemaVersion: 1,
      testCaseId: "tc-hover",
      projectId: "proj-1",
      name: "Hover Reveal",
      tags: [],
      steps: [
        { id: "h1", type: "navigate", value: { kind: "variable", path: "base_url" }, enabled: true },
        {
          id: "h2",
          type: "hover",
          target: { preferred: { strategy: "css", value: ".figure", quality: "fragile" }, alternatives: [] },
          enabled: true,
        },
      ],
    };
    const result = PlaywrightPythonPytestGenerator.generate(model, ctx);
    const page = result.pageObjectFiles[0].content;
    expect(page).toMatch(/self\.\w+\.hover\(\)/);
  });
});

describe("PlaywrightPythonPytestGenerator — random/boundary fills use real keystrokes", () => {
  const ctx = { projectDirectory: "C:/proj", projectCode: "PROJ", existingPageObjectNames: [] };

  it("regression: a random-value fill is typed via click() + press_sequentially(), not .fill() — a real report of a random value being typed but 'not accepted' by the app traced to .fill() setting the DOM value directly without emitting real keydown/keyup events, which live autocomplete/typeahead search and per-keystroke validation only respond to", () => {
    const model: TestModel = {
      schemaVersion: 1,
      testCaseId: "tc-random-fill",
      projectId: "proj-1",
      name: "Random Fill Keystrokes",
      tags: [],
      steps: [
        { id: "r1", type: "navigate", value: { kind: "variable", path: "base_url" }, enabled: true },
        {
          id: "r2",
          type: "fill",
          target: { preferred: { strategy: "role", value: "textbox", roleName: "Location Name", quality: "excellent" }, alternatives: [] },
          value: { kind: "random", generator: "randomString", seedOnce: false },
          enabled: true,
        },
      ],
    };
    const result = PlaywrightPythonPytestGenerator.generate(model, ctx);
    const page = result.pageObjectFiles[0].content;
    expect(page).toMatch(/self\.\w+\.click\(\)\s*\n\s*self\.\w+\.press_sequentially\(random_data\.random_string\(\)\)/);
    expect(page).not.toMatch(/self\.\w+\.fill\(random_data\.random_string\(\)\)/);
  });

  it("a plain literal fill still uses .fill() (unaffected — no evidence of that being broken, and it's meaningfully faster)", () => {
    const model: TestModel = {
      schemaVersion: 1,
      testCaseId: "tc-literal-fill",
      projectId: "proj-1",
      name: "Literal Fill",
      tags: [],
      steps: [
        { id: "l1", type: "navigate", value: { kind: "variable", path: "base_url" }, enabled: true },
        {
          id: "l2",
          type: "fill",
          target: { preferred: { strategy: "role", value: "textbox", roleName: "Notes", quality: "excellent" }, alternatives: [] },
          value: { kind: "literal", value: "hello" },
          enabled: true,
        },
      ],
    };
    const result = PlaywrightPythonPytestGenerator.generate(model, ctx);
    const page = result.pageObjectFiles[0].content;
    expect(page).toMatch(/self\.\w+\.fill\("hello"\)/);
    expect(page).not.toContain("press_sequentially");
  });
});
