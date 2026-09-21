import type { CodeGeneratorAdapter, CodeGenerationResult, GeneratedFile, GenerationContext } from "./CodeGeneratorAdapter";
import type { TestModel, TestStep, LocatorCandidate, TestValue, Assertion } from "../../../shared/testModel";
import { generateBoundaryValue } from "../../../shared/randomData";
import { pyStr, toSnakeCase, toPascalCase, toPythonIdentifier } from "../pythonSyntax";

const SUITE_FOLDER_PRIORITY = ["bvt", "smoke", "sanity", "regression"];

const RANDOM_GENERATOR_TO_PY: Record<string, string> = {
  firstName: "first_name", lastName: "last_name", fullName: "full_name",
  email: "email", phone: "phone", address: "address", uuid: "uuid",
  integer: "integer", decimal: "decimal", alphanumeric: "alphanumeric",
  randomString: "random_string", date: "date", pastDate: "past_date",
  futureDate: "future_date", url: "url", customPattern: "custom_pattern",
};

interface LocatorBinding {
  attrName: string;
  candidate: LocatorCandidate;
}

function renderLocatorExpr(candidate: LocatorCandidate, warnings: string[], stepId: string): string {
  if (candidate.quality === "avoid") {
    warnings.push(`Step ${stepId}: locator quality is "avoid" — consider recording a better selector.`);
  }
  switch (candidate.strategy) {
    case "role":
      return candidate.roleName
        ? `page.get_by_role(${pyStr(candidate.value)}, name=${pyStr(candidate.roleName)})`
        : `page.get_by_role(${pyStr(candidate.value)})`;
    case "testId":
      return `page.get_by_test_id(${pyStr(candidate.value)})`;
    case "label":
      return `page.get_by_label(${pyStr(candidate.value)})`;
    case "placeholder":
      return `page.get_by_placeholder(${pyStr(candidate.value)})`;
    case "text":
      return `page.get_by_text(${pyStr(candidate.value)})`;
    case "xpath":
      return `page.locator(${pyStr("xpath=" + candidate.value)})`;
    case "css":
    default:
      return `page.locator(${pyStr(candidate.value)})`;
  }
}

function resolveVariablePath(path: string): string {
  if (path === "base_url" || path === "api_url") return `env[${pyStr(path)}]`;
  if (path.startsWith("credentials.")) {
    const [, profile, field] = path.split(".");
    return `creds[${pyStr(profile ?? "default")}][${pyStr(field ?? "value")}]`;
  }
  return `env.get(${pyStr(path)})`;
}

function renderValueExpr(value: TestValue | undefined): string {
  if (!value) return "None";
  switch (value.kind) {
    case "literal":
      return pyStr(value.value);
    case "variable":
      return resolveVariablePath(value.path);
    case "random":
      if (value.seedOnce && value.generatedValue !== undefined) return pyStr(value.generatedValue);
      return `random_data.${RANDOM_GENERATOR_TO_PY[value.generator] ?? "random_string"}(${
        value.generator === "customPattern" && value.pattern ? pyStr(value.pattern) : ""
      })`;
    case "boundary":
      return pyStr(generateBoundaryValue(value.boundary));
    default:
      return "None";
  }
}

function renderAssertion(assertion: Assertion, locatorExpr: string | null, warnings: string[], stepId: string): string {
  const expected = assertion.expected ? renderValueExpr(assertion.expected) : undefined;
  switch (assertion.type) {
    case "visible": return `expect(${locatorExpr}).to_be_visible()`;
    case "hidden": return `expect(${locatorExpr}).to_be_hidden()`;
    case "enabled": return `expect(${locatorExpr}).to_be_enabled()`;
    case "disabled": return `expect(${locatorExpr}).to_be_disabled()`;
    case "checked": return `expect(${locatorExpr}).to_be_checked()`;
    case "unchecked": return `expect(${locatorExpr}).not_to_be_checked()`;
    case "textEquals": return `expect(${locatorExpr}).to_have_text(${expected})`;
    case "textContains": return `expect(${locatorExpr}).to_contain_text(${expected})`;
    case "valueEquals": return `expect(${locatorExpr}).to_have_value(${expected})`;
    case "valueContains": return `assert ${expected} in (${locatorExpr}.input_value())`;
    case "attributeEquals": return `assert ${locatorExpr}.get_attribute(${pyStr(assertion.attribute ?? "")}) == ${expected}`;
    case "elementCount": return `expect(${locatorExpr}).to_have_count(int(${expected}))`;
    case "urlEquals": return `expect(page).to_have_url(${expected})`;
    case "urlContains": return `assert ${expected} in page.url`;
    case "pageTitle": return `expect(page).to_have_title(${expected})`;
    case "apiStatus":
    case "apiResponse":
    case "screenshotComparison":
      warnings.push(`Step ${stepId}: assertion type "${assertion.type}" is not yet supported by the Phase 1 generator (Coming Soon) — emitting a TODO.`);
      return `# TODO: "${assertion.type}" assertion not yet generated (Coming Soon)`;
    default:
      return `# TODO: unsupported assertion`;
  }
}

const STEP_ACTION_PY: Record<string, (locatorExpr: string, valueExpr: string) => string> = {
  click: (l) => `${l}.click()`,
  doubleClick: (l) => `${l}.dblclick()`,
  fill: (l, v) => `${l}.fill(${v})`,
  clear: (l) => `${l}.clear()`,
  select: (l, v) => `${l}.select_option(${v})`,
  check: (l) => `${l}.check()`,
  uncheck: (l) => `${l}.uncheck()`,
  hover: (l) => `${l}.hover()`,
  upload: (l, v) => `${l}.set_input_files(${v})`,
  dragAndDrop: (l, v) => `${l}.drag_to(${v})`,
};

function detectLoginGroup(steps: TestStep[]): boolean {
  const hasUserField = steps.some(
    (s) => s.type === "fill" && /user ?name|login|email/i.test(s.target?.preferred.roleName ?? "")
  );
  const hasPasswordField = steps.some(
    (s) => s.type === "fill" && /password/i.test(s.target?.preferred.roleName ?? "")
  );
  const hasSubmit = steps.some(
    (s) => s.type === "click" && /log ?in|sign ?in/i.test(s.target?.preferred.roleName ?? "")
  );
  return hasUserField && hasPasswordField && hasSubmit;
}

function groupSteps(steps: TestStep[]): TestStep[][] {
  const groups: TestStep[][] = [];
  let current: TestStep[] = [];
  for (const step of steps) {
    if (step.type === "navigate" && current.length > 0) {
      groups.push(current);
      current = [];
    }
    current.push(step);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function methodNameForGroup(group: TestStep[], index: number): string {
  const noted = group.find((s) => s.note)?.note;
  if (noted) return toPythonIdentifier(noted, `step_group_${index}`);
  if (detectLoginGroup(group)) return "login";
  const namedTarget = group.find((s) => s.target?.preferred.roleName || s.target?.preferred.value);
  if (namedTarget?.target) {
    const label = namedTarget.target.preferred.roleName ?? namedTarget.target.preferred.value;
    return toPythonIdentifier(label, `step_group_${index}`);
  }
  return `step_group_${index}`;
}

export const PlaywrightPythonPytestGenerator: CodeGeneratorAdapter = {
  language: "python",
  framework: "playwright",
  testRunner: "pytest",
  style: "page_object_model",

  generate(model: TestModel, ctx: GenerationContext): CodeGenerationResult {
    const warnings: string[] = [];
    const enabledSteps = model.steps.filter((s) => s.enabled);

    const testNameSnake = toSnakeCase(model.name);
    const pageClassName = `${toPascalCase(model.name)}Page`;
    const pageModuleName = `${testNameSnake}_page`;

    // Suite folder: first matching known suite tag by priority, else "uncategorized".
    const folder = SUITE_FOLDER_PRIORITY.find((tag) => model.tags.includes(tag)) ?? "uncategorized";

    // Collect distinct locators across the whole test for __init__.
    const locatorBindings: LocatorBinding[] = [];
    const seen = new Set<string>();
    for (const step of enabledSteps) {
      if (!step.target) continue;
      const cand = step.target.preferred;
      const key = `${cand.strategy}:${cand.value}:${cand.roleName ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const baseName = cand.roleName || cand.value || step.type;
      locatorBindings.push({ attrName: toPythonIdentifier(baseName, `element_${locatorBindings.length + 1}`), candidate: cand });
    }
    // De-duplicate attribute names.
    const nameCounts = new Map<string, number>();
    for (const b of locatorBindings) {
      const count = (nameCounts.get(b.attrName) ?? 0) + 1;
      nameCounts.set(b.attrName, count);
      if (count > 1) b.attrName = `${b.attrName}_${count}`;
    }
    const locatorByKey = new Map<string, string>();
    for (const b of locatorBindings) {
      const key = `${b.candidate.strategy}:${b.candidate.value}:${b.candidate.roleName ?? ""}`;
      locatorByKey.set(key, b.attrName);
    }
    function attrFor(step: TestStep): string | null {
      if (!step.target) return null;
      const cand = step.target.preferred;
      const key = `${cand.strategy}:${cand.value}:${cand.roleName ?? ""}`;
      return locatorByKey.get(key) ?? null;
    }

    const groups = groupSteps(enabledSteps);
    // A method name that collides with a locator attribute name (both are
    // just class attributes to Python) would have the instance attribute
    // set in __init__ silently shadow the method forever after, turning
    // `self.login(...)` into `self.<Locator>(...)` — "'Locator' object is
    // not callable". Reserve every locator attribute name, "page", and
    // "__init__" so a method name never lands on one of them.
    const reservedNames = new Set<string>(["page", "__init__", ...locatorBindings.map((b) => b.attrName)]);
    const usedMethodNames = new Set<string>();
    const methods: { name: string; body: string[] }[] = [];

    groups.forEach((group, index) => {
      let name = methodNameForGroup(group, index);
      if (reservedNames.has(name)) name = `${name}_flow`;
      if (usedMethodNames.has(name)) name = `${name}_${index}`;
      usedMethodNames.add(name);

      const body: string[] = [];
      for (const step of group) {
        if (step.type === "navigate") {
          body.push(`self.page.goto(${renderValueExpr(step.value)})`);
          continue;
        }
        if (step.type === "assert") {
          const locatorExpr = step.target ? `self.${attrFor(step)}` : null;
          if (step.assertion) body.push(renderAssertion(step.assertion, locatorExpr, warnings, step.id));
          continue;
        }
        if (step.type === "goBack") { body.push("self.page.go_back()"); continue; }
        if (step.type === "goForward") { body.push("self.page.go_forward()"); continue; }
        if (step.type === "refresh") { body.push("self.page.reload()"); continue; }
        if (step.type === "pressKey") { body.push(`self.page.keyboard.press(${renderValueExpr(step.value)})`); continue; }
        if (step.type === "scroll") { body.push(`self.page.mouse.wheel(0, 800)`); continue; }
        if (step.type === "newTab" || step.type === "closeTab" || step.type === "download" || step.type === "flowRef") {
          warnings.push(`Step ${step.id}: "${step.type}" is not yet generated by the Phase 1 generator (Coming Soon) — emitting a TODO.`);
          body.push(`# TODO: "${step.type}" step not yet generated (Coming Soon)`);
          continue;
        }

        const attr = attrFor(step);
        if (!attr) {
          warnings.push(`Step ${step.id}: no target locator available; skipped.`);
          continue;
        }
        const action = STEP_ACTION_PY[step.type];
        if (!action) {
          body.push(`# TODO: unsupported step type "${step.type}"`);
          continue;
        }
        body.push(action(`self.${attr}`, renderValueExpr(step.value)));

        if (step.screenshotOnStep) {
          body.push(`maybe_screenshot(self.page, ${pyStr(step.id)})`);
        }
      }
      methods.push({ name, body: body.length > 0 ? body : ["pass"] });
    });

    // ---- pages/<test>_page.py -----------------------------------------
    const initLines = locatorBindings.map(
      (b) => `        self.${b.attrName} = ${renderLocatorExpr(b.candidate, warnings, "init")}`
    );
    const pageLines: string[] = [
      "from playwright.sync_api import Page, expect",
      "",
      "from utils import random_data",
      "from utils.screenshots import maybe_screenshot",
      "",
      "",
      `class ${pageClassName}:`,
      '    """Generated by Automation AI Studio. Regenerating overwrites this file unless it has been manually modified — see docs/SECURITY.md."""',
      "",
      "    def __init__(self, page: Page):",
      "        self.page = page",
      ...(initLines.length > 0 ? initLines : ["        # No element locators were recorded for this test."]),
      "",
    ];
    for (const m of methods) {
      pageLines.push(`    def ${m.name}(self, env: dict, creds: dict) -> None:`);
      for (const line of m.body) pageLines.push(`        ${line}`);
      pageLines.push("");
    }

    const pageObjectFile: GeneratedFile = {
      relativePath: `pages/${pageModuleName}.py`,
      content: pageLines.join("\n"),
    };

    // ---- tests/<folder>/test_<name>.py ---------------------------------
    const markers = model.tags.map((t) => `@pytest.mark.${toSnakeCase(t)}`);
    const testLines = [
      "import pytest",
      `from pages.${pageModuleName} import ${pageClassName}`,
      "",
      "",
      ...markers,
      `def test_${testNameSnake}(page, env, creds):`,
      `    ${toSnakeCase(model.name)}_page = ${pageClassName}(page)`,
      ...methods.map((m) => `    ${toSnakeCase(model.name)}_page.${m.name}(env, creds)`),
      "",
    ];
    const testFile: GeneratedFile = {
      relativePath: `tests/${folder}/test_${testNameSnake}.py`,
      content: testLines.join("\n"),
    };

    return {
      testFile,
      pageObjectFiles: [pageObjectFile],
      supportFiles: buildSupportFiles(ctx),
      testFilePath: testFile.relativePath,
      pageObjectPaths: [pageObjectFile.relativePath],
      warnings,
    };
  },
};

/**
 * Project-level scaffolding, created once per project (the caller only
 * writes these if they don't already exist on disk — see
 * docs/AUTOMATION_ADAPTERS.md, "conftest.py is only ever created if absent").
 */
function buildSupportFiles(_ctx: GenerationContext): GeneratedFile[] {
  const conftest = `import json
import os
import pytest
from playwright.sync_api import sync_playwright


@pytest.fixture(scope="session")
def env():
    return {
        "base_url": os.environ.get("BASE_URL", ""),
        "api_url": os.environ.get("API_URL", ""),
    }


@pytest.fixture(scope="session")
def creds():
    raw = os.environ.pop("AAS_CREDENTIALS_JSON", "{}")
    return json.loads(raw)


@pytest.fixture()
def page():
    headless = os.environ.get("HEADLESS", "true").lower() == "true"
    browser_name = os.environ.get("BROWSER", "chromium")
    with sync_playwright() as playwright:
        browser_type = getattr(playwright, browser_name if browser_name != "chrome" else "chromium")
        launch_kwargs = {"headless": headless}
        if browser_name == "chrome":
            launch_kwargs["channel"] = "chrome"
        browser = browser_type.launch(**launch_kwargs)
        context = browser.new_context()
        page = context.new_page()
        yield page
        context.close()
        browser.close()


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    report = outcome.get_result()
    if report.when == "call" and report.failed:
        page = item.funcargs.get("page")
        if page is not None:
            artifacts_dir = os.environ.get("ARTIFACTS_DIR", "artifacts")
            os.makedirs(artifacts_dir, exist_ok=True)
            page.screenshot(path=os.path.join(artifacts_dir, f"{item.name}_failure.png"))
`;

  const pytestIni = `[pytest]
markers =
    bvt: Build Verification Test
    smoke: Smoke suite
    sanity: Sanity suite
    regression: Regression suite
    critical: Critical path
    end_to_end: End-to-end suite
    negative: Negative-path suite
    cross_browser: Cross-browser suite
`;

  const requirements = `playwright>=1.47
pytest>=8.0
pytest-json-report>=1.5
pytest-xdist>=3.6
`;

  const randomDataPy = `"""Random / dynamic test-data generation. Mirrors electron/shared/randomData.ts."""
import random
import string
import uuid as uuid_lib
from datetime import date, timedelta

_FIRST_NAMES = ["James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Priya", "Wei", "Fatima", "Carlos"]
_LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Garcia", "Patel", "Chen", "Khan", "Silva", "Martin"]


def first_name() -> str:
    return random.choice(_FIRST_NAMES)


def last_name() -> str:
    return random.choice(_LAST_NAMES)


def full_name() -> str:
    return f"{first_name()} {last_name()}"


def email() -> str:
    return f"{first_name().lower()}.{alphanumeric(5).lower()}@example.com"


def phone() -> str:
    return f"({random.randint(100,999)}) {random.randint(100,999)}-{random.randint(1000,9999)}"


def address() -> str:
    return f"{random.randint(1,9999)} Main St"


def uuid() -> str:
    return str(uuid_lib.uuid4())


def integer() -> str:
    return str(random.randint(0, 1_000_000))


def decimal() -> str:
    return f"{random.uniform(0, 10000):.2f}"


def alphanumeric(length: int = 10) -> str:
    return "".join(random.choices(string.ascii_letters + string.digits, k=length))


def random_string() -> str:
    return alphanumeric(12)


def date_() -> str:
    return date.today().isoformat()


def past_date() -> str:
    return (date.today() - timedelta(days=random.randint(1, 365))).isoformat()


def future_date() -> str:
    return (date.today() + timedelta(days=random.randint(1, 365))).isoformat()


def url() -> str:
    return f"https://example.com/{alphanumeric(6).lower()}"


def custom_pattern(pattern: str = "####") -> str:
    out = []
    for ch in pattern:
        if ch == "#":
            out.append(str(random.randint(0, 9)))
        elif ch == "?":
            out.append(random.choice(string.ascii_lowercase))
        else:
            out.append(ch)
    return "".join(out)


# Alias matching the "date" keyword (a Python builtin name) used by the generator.
globals()["date"] = date_
`;

  const screenshotsPy = `"""Optional per-step screenshot capture, used when a test's screenshot strategy is "Every Step"."""
import os
from playwright.sync_api import Page


def maybe_screenshot(page: Page, step_id: str) -> None:
    if os.environ.get("SCREENSHOT_STRATEGY") != "everyStep":
        return
    artifacts_dir = os.environ.get("ARTIFACTS_DIR", "artifacts")
    os.makedirs(artifacts_dir, exist_ok=True)
    page.screenshot(path=os.path.join(artifacts_dir, f"step_{step_id}.png"))
`;

  const gitignore = `.venv/
__pycache__/
.pytest_cache/
artifacts/
report.json
junit.xml
*.pyc
.env
.env.*
`;

  const readme = `# Generated automation project

This project's tests, Page Objects, and config are generated by **Automation AI
Studio** from a framework-neutral Test Model — see the Studio's \`docs/TEST_MODEL.md\`.

- \`pages/\` — Page Objects (locators + step logic)
- \`tests/<suite>/\` — Pytest test files, grouped by suite (bvt/smoke/sanity/regression)
- \`utils/\` — shared helpers (random test data, screenshot capture)
- \`conftest.py\` — fixtures (\`page\`, \`env\`, \`creds\`); created once, never silently overwritten
- \`pytest.ini\` — registered suite markers

Run locally:

\`\`\`
pip install -r requirements.txt
playwright install
pytest -m smoke
\`\`\`

Files generated by the Studio are safe to regenerate as long as they haven't been
edited outside it — if they have, the Studio will ask before overwriting.
`;

  return [
    { relativePath: "conftest.py", content: conftest },
    { relativePath: "pytest.ini", content: pytestIni },
    { relativePath: "requirements.txt", content: requirements },
    { relativePath: "utils/random_data.py", content: randomDataPy },
    { relativePath: "utils/screenshots.py", content: screenshotsPy },
    { relativePath: "utils/__init__.py", content: "" },
    { relativePath: "pages/__init__.py", content: "" },
    { relativePath: ".gitignore", content: gitignore },
    { relativePath: "README.md", content: readme },
  ];
}
