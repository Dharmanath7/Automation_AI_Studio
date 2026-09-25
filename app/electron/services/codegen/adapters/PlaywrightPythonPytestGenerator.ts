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
        ? `self.page.get_by_role(${pyStr(candidate.value)}, name=${pyStr(candidate.roleName)})`
        : `self.page.get_by_role(${pyStr(candidate.value)})`;
    case "testId":
      return `self.page.get_by_test_id(${pyStr(candidate.value)})`;
    case "label":
      return `self.page.get_by_label(${pyStr(candidate.value)})`;
    case "placeholder":
      return `self.page.get_by_placeholder(${pyStr(candidate.value)})`;
    case "text":
      return `self.page.get_by_text(${pyStr(candidate.value)})`;
    case "xpath":
      return `self.page.locator(${pyStr("xpath=" + candidate.value)})`;
    case "css":
    default:
      return `self.page.locator(${pyStr(candidate.value)})`;
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

/**
 * A one-line, self-contained description of a step for the "# STEP n: ..."
 * comment emitted before its generated code (see the marker comment below)
 * — self-contained so a failed run can be traced back to a plain-language
 * description of which recorded/manual action broke just by reading the
 * generated source at the traceback's line number, without needing to look
 * anything back up against the (possibly since-edited) Test Model.
 */
function describeStepForMarker(step: TestStep): string {
  const target = step.target?.preferred;
  if (!target) return step.type;
  const label = target.roleName ?? target.value;
  return `${step.type} "${label}" (${target.strategy})`;
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
    // 1-based position in the overall (enabled) step list — used to number
    // the "# STEP n: ..." marker comment emitted before each step's code,
    // so a failure's traceback line number can be traced back to plainly
    // which step it was without needing the Test Model at all.
    const globalStepIndexById = new Map<string, number>();
    enabledSteps.forEach((s, i) => globalStepIndexById.set(s.id, i + 1));
    // A method name that collides with a locator attribute name (both are
    // just class attributes to Python) would have the instance attribute
    // set in __init__ silently shadow the method forever after, turning
    // `self.login(...)` into `self.<Locator>(...)` — "'Locator' object is
    // not callable". Reserve every locator attribute name, "page", and
    // "__init__" so a method name never lands on one of them.
    const reservedNames = new Set<string>(["page", "__init__", ...locatorBindings.map((b) => b.attrName)]);
    const usedMethodNames = new Set<string>();
    const methods: { name: string; body: string[] }[] = [];

    // A "newTab" step immediately following a click/doubleClick (exactly
    // what the recorder emits when an interaction opens a new browser tab —
    // see electron/services/recorder/recorderService.ts) is absorbed into
    // that click: the click is wrapped in context.expect_page() and
    // self.page is reassigned to the new tab, rather than generating a
    // separate step for it.
    const tabOpeningStepIds = new Set<string>();
    const absorbedNewTabStepIds = new Set<string>();
    for (let i = 0; i < enabledSteps.length; i++) {
      const step = enabledSteps[i];
      if (step.type !== "newTab") continue;
      const prev = enabledSteps[i - 1];
      if (prev && (prev.type === "click" || prev.type === "doubleClick")) {
        tabOpeningStepIds.add(prev.id);
        absorbedNewTabStepIds.add(step.id);
      }
    }
    // Steps whose action plausibly triggers a same-tab navigation — a
    // wait_for_load_state() after these is cheap when nothing actually
    // navigated (it returns immediately) and prevents the classic "clicked
    // too fast, next locator wasn't there yet" flake on slower pages.
    const NAVIGATION_TRIGGERING_TYPES = new Set(["click", "doubleClick", "goBack", "goForward", "refresh"]);

    groups.forEach((group, index) => {
      let name = methodNameForGroup(group, index);
      if (reservedNames.has(name)) name = `${name}_flow`;
      if (usedMethodNames.has(name)) name = `${name}_${index}`;
      usedMethodNames.add(name);

      const body: string[] = [];
      const smartWait = () => body.push('self.page.wait_for_load_state("domcontentloaded")');

      for (const step of group) {
        body.push(`# STEP ${globalStepIndexById.get(step.id) ?? "?"}: ${describeStepForMarker(step)}`);
        if (step.type === "navigate") {
          body.push(`self.page.goto(${renderValueExpr(step.value)})`);
          smartWait();
          continue;
        }
        if (step.type === "assert") {
          const locatorExpr = step.target ? `self.${attrFor(step)}` : null;
          if (step.assertion) body.push(renderAssertion(step.assertion, locatorExpr, warnings, step.id));
          continue;
        }
        if (step.type === "goBack") { body.push("self.page.go_back()"); smartWait(); continue; }
        if (step.type === "goForward") { body.push("self.page.go_forward()"); smartWait(); continue; }
        if (step.type === "refresh") { body.push("self.page.reload()"); smartWait(); continue; }
        if (step.type === "pressKey") { body.push(`self.page.keyboard.press(${renderValueExpr(step.value)})`); continue; }
        if (step.type === "scroll") { body.push(`self.page.mouse.wheel(0, 800)`); continue; }
        if (step.type === "newTab") {
          if (absorbedNewTabStepIds.has(step.id)) continue; // handled by the preceding click below
          // A newTab step with no preceding click (e.g. added manually in
          // the editor) — fall back to grabbing whatever tab most recently
          // opened in this context.
          body.push("self.page = self.page.context.pages[-1]");
          smartWait();
          continue;
        }
        if (step.type === "closeTab" || step.type === "download" || step.type === "flowRef") {
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

        if (step.type === "fill" && (step.value?.kind === "random" || step.value?.kind === "boundary")) {
          // .fill() sets the value directly (native setter + input/change
          // events), which most fields handle fine — but a dynamically
          // generated value is exactly the kind most likely to land on a
          // field with keydown/keyup-driven logic (a live autocomplete/
          // typeahead search, an input mask, per-keystroke validation),
          // which .fill() never triggers at all since it isn't real
          // keystrokes. Caught via a real report of a random value being
          // typed but "not accepted" by the app. press_sequentially()
          // simulates each character as an actual keydown/keypress/input/
          // keyup sequence, same as a person typing, which those listeners
          // do respond to. An explicit click first guarantees focus,
          // rather than relying on press_sequentially to establish it.
          body.push(`self.${attr}.click()`);
          body.push(`self.${attr}.press_sequentially(${renderValueExpr(step.value)})`);
          if (step.screenshotOnStep) {
            body.push(`maybe_screenshot(self.page, ${pyStr(step.id)})`);
          }
          continue;
        }

        if ((step.type === "click" || step.type === "doubleClick") && tabOpeningStepIds.has(step.id)) {
          // This click opens a new browser tab (recorded as a click
          // immediately followed by a "newTab" step). Wrap it so Playwright
          // captures the new Page object, then make it the active page for
          // every step after this one — see docs/TEST_MODEL.md and the
          // "tab switch" note in docs/EXECUTION_ENGINE.md.
          body.push("with self.page.context.expect_page() as new_page_info:");
          body.push(`    ${action(`self.${attr}`, renderValueExpr(step.value))}`);
          body.push("self.page = new_page_info.value");
          smartWait();
          continue;
        }

        body.push(action(`self.${attr}`, renderValueExpr(step.value)));
        if (NAVIGATION_TRIGGERING_TYPES.has(step.type)) smartWait();

        if (step.screenshotOnStep) {
          body.push(`maybe_screenshot(self.page, ${pyStr(step.id)})`);
        }
      }
      methods.push({ name, body: body.length > 0 ? body : ["pass"] });
    });

    // ---- pages/<test>_page.py -----------------------------------------
    // Locators are @property methods that resolve against self.page fresh
    // on every access — not attributes bound once in __init__ — so that if
    // a step reassigns self.page (see the tab-opening click handling
    // above), every locator used afterward automatically resolves against
    // the new tab instead of silently continuing to query the old one.
    const propertyLines: string[] = [];
    for (const b of locatorBindings) {
      propertyLines.push("    @property");
      propertyLines.push(`    def ${b.attrName}(self) -> Locator:`);
      propertyLines.push(`        return ${renderLocatorExpr(b.candidate, warnings, "init")}`);
      propertyLines.push("");
    }
    const pageLines: string[] = [
      "from playwright.sync_api import Page, Locator, expect",
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
      "",
      ...(propertyLines.length > 0 ? propertyLines : ["    # No element locators were recorded for this test.", ""]),
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
from playwright.sync_api import sync_playwright, expect


@pytest.fixture(scope="session")
def env():
    return {
        "base_url": os.environ.get("BASE_URL", ""),
        "api_url": os.environ.get("API_URL", ""),
        # Smart-wait budget: how long actions, navigations, and assertions
        # wait for the page to catch up before failing. Configured per
        # Environment in Automation AI Studio (Environments & Credentials);
        # defaults to 30s if unset. Playwright's own expect() default is a
        # much stricter 5s, which is a common cause of tests failing on
        # slower-loading pages even though the page eventually loads fine —
        # see docs/EXECUTION_ENGINE.md "Smart waits".
        "timeout_ms": int(os.environ.get("TIMEOUT_MS", "30000")),
    }


class _CredsDict(dict):
    """A dict that raises an actionable error instead of a bare KeyError.

    creds["default"]["password"] on an environment with no Credential Vault
    profile linked raises "KeyError: 'default'" with no indication of what
    to actually do about it — a very easy way for "most tests keep failing"
    to happen invisibly, especially for a recorded login (which references
    credentials.default.password automatically). This turns that into a
    message pointing at the exact fix.
    """

    def __missing__(self, key):
        raise KeyError(
            f"No Credential Vault value is set for '{key}' in this environment. "
            f"In Automation AI Studio, open this test (or the environment's "
            f"Environments & Credentials page) and set/link a credential profile "
            f"for '{key}' before running — see the 'Credentials Used' panel."
        )


@pytest.fixture(scope="session")
def creds():
    raw = os.environ.pop("AAS_CREDENTIALS_JSON", "{}")
    data = json.loads(raw)
    return _CredsDict({profile: _CredsDict(fields) for profile, fields in data.items()})


@pytest.fixture(scope="session", autouse=True)
def _configure_smart_waits(env):
    # Applies to every expect(...) assertion in every generated test, not
    # just this one — expect.set_options is process-global by design.
    expect.set_options(timeout=env["timeout_ms"])



# "edge" and "chrome" are channels of the chromium engine, not engines of
# their own — Playwright's Python API has no playwright.edge / playwright.chrome
# attribute, so resolving them naively (getattr(playwright, browser_name))
# raises AttributeError. Map each selectable browser to its actual engine
# plus, where relevant, the channel that picks the system-installed build.
_BROWSER_ENGINES = {"chrome": "chromium", "edge": "chromium", "chromium": "chromium", "firefox": "firefox", "webkit": "webkit"}
_BROWSER_CHANNELS = {"chrome": "chrome", "edge": "msedge"}


@pytest.fixture()
def page(env):
    headless = os.environ.get("HEADLESS", "true").lower() == "true"
    browser_name = os.environ.get("BROWSER", "chromium")
    with sync_playwright() as playwright:
        engine_name = _BROWSER_ENGINES.get(browser_name, "chromium")
        browser_type = getattr(playwright, engine_name)
        launch_kwargs = {"headless": headless}
        channel = _BROWSER_CHANNELS.get(browser_name)
        if channel:
            launch_kwargs["channel"] = channel
        if not headless and engine_name == "chromium":
            # Chromium-family only: launch maximized and let the page fill
            # the real window size (viewport=None below) instead of
            # Playwright's small fixed default — most useful while watching
            # a headed run, same as the recorder.
            launch_kwargs["args"] = ["--start-maximized"]
        browser = browser_type.launch(**launch_kwargs)
        context_kwargs = {"no_viewport": True} if (not headless and engine_name == "chromium") else {}
        context = browser.new_context(**context_kwargs)
        # Context-level (not just page-level) so any additional tab/window
        # opened during the test — see docs on the "newTab" step — inherits
        # the same smart-wait budget automatically.
        context.set_default_timeout(env["timeout_ms"])
        context.set_default_navigation_timeout(env["timeout_ms"])
        # Auto-accept any dialog (alert/confirm/prompt/beforeunload) on every
        # page/tab in this context. Without this, a single unexpected dialog
        # — most commonly a "leave site?" beforeunload prompt triggered by a
        # navigation-away step — sits there forever: Playwright does not
        # dismiss dialogs automatically, so it blocks whatever action
        # triggered it and then blocks context.close()/browser.close() at
        # teardown too, since a dialog is still open on a page being closed.
        # From the outside this looks exactly like "the test finished but
        # the browser doesn't close on its own" — every step ran, then the
        # run hangs and is eventually reported as failed once the harness's
        # own timeout kicks in.
        context.on("dialog", lambda dialog: dialog.accept())
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
import time
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
    # Deliberately garbage-looking (lowercase letters + trailing digits) so
    # it's never mistaken for a real value — mirrors electron/shared/randomData.ts.
    # The trailing digits are a millisecond-timestamp fragment, not just
    # random.choices() — every value is then actually unique (not merely
    # "very probably" unique), so re-running the same test repeatedly can
    # never collide with a value an earlier run already used, which matters
    # whenever the system under test enforces its own uniqueness constraint
    # (e.g. rejecting a duplicate name).
    letters = "".join(random.choices(string.ascii_lowercase, k=random.randint(6, 10)))
    unique_suffix = str(int(time.time() * 1000))[-8:]
    return f"{letters}{unique_suffix}"


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
