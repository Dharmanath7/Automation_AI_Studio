# Code Generator Adapters

## Interface

```ts
// app/electron/services/codegen/adapters/CodeGeneratorAdapter.ts
export interface GeneratedFile {
  relativePath: string;   // relative to project.project_directory
  content: string;
}

export interface CodeGenerationResult {
  testFile: GeneratedFile;
  pageObjectFiles: GeneratedFile[];
  supportFiles: GeneratedFile[];   // conftest.py, config files created/updated if missing
  testFilePath: string;            // convenience: testFile.relativePath
  pageObjectPaths: string[];
}

export interface CodeGeneratorAdapter {
  readonly language: string;
  readonly framework: string;
  readonly testRunner: string;
  readonly style: string;

  /** Pure function: model in, file contents out. Never touches disk itself. */
  generate(model: TestModel, ctx: GenerationContext): CodeGenerationResult;
}

export interface GenerationContext {
  projectDirectory: string;
  projectCode: string;
  existingPageObjectNames: string[]; // for de-duplication / reuse decisions
}
```

`generate()` is a **pure function**. Writing the result to disk, checking
`automation_mappings.source_origin` for a `manually_modified` conflict, and prompting
the user (`View Diff / Merge / Overwrite / Cancel`, per `SECURITY.md` §6) is the
caller's job (`services/testCaseService.ts`), not the adapter's. This keeps adapters
trivially unit-testable with golden-file comparisons.

## Phase 1 implementation: `PlaywrightPythonPytestGenerator`

Generates a Page Object Model Python/Playwright/Pytest project.

### Project layout it writes into

```
<project_directory>/
  config/
    environments.yaml        # created once, updated (not overwritten) as environments change
  pages/
    <page>_page.py            # one per distinct "page" inferred from step target grouping
  tests/
    bvt/ | smoke/ | sanity/ | regression/ | uncategorized/
      test_<snake_case_name>.py
  data/
    <test>_data.json          # only written when the model uses "Generate Once" random data
  utils/
    random_data.py            # shared helper, written once, not per test
  conftest.py                 # fixtures: page, screenshot-on-failure hook, env/credential loading
  pytest.ini                  # markers registered here (bvt, smoke, sanity, regression, ...)
  requirements.txt
  README.md
```

### Mapping rules

- **Suite → folder + marker.** Each tag in `TestModel.tags` that matches a known
  suite (`bvt`, `smoke`, `sanity`, `regression`, ...) becomes both a `@pytest.mark.<tag>`
  decorator and determines the primary folder the test file is written into (first
  matching tag in priority order `bvt > smoke > sanity > regression`, others always
  keep their marker even if not the folder choice).
- **Page inference.** Consecutive steps are grouped into a "page" whenever a
  `navigate` step occurs, or when the accessible name context changes in a way the
  recorder tagged with a new `pageHint` (Phase 2). Phase 1 keeps this simple: one
  Page Object per Test Case named after the test (`<TestName>Page`), with locators as
  class-level `Locator` properties and one method per logical action group
  (`login(username, password)`, `search_provider(name)`), not one raw method per
  step — this is what keeps generated code maintainable rather than a flat replay
  script.
- **Locator selection.** For each `StepTarget`, the generator picks
  `target.preferred` unless its `quality` is `"avoid"`, in which case it picks the
  best-quality alternative and records a warning surfaced in the UI's Test Review
  Assistant. Role-based locators generate
  `page.get_by_role("button", name="Login")`; `testId` generates
  `page.get_by_test_id(...)`; `label`/`placeholder`/`text` map to their respective
  `get_by_*`; `css`/`xpath` are last resort (`page.locator(...)`).
- **Values.** `{ kind: "variable", path }` renders as a reference into the fixture
  namespace (`env["base_url"]`, `creds["default"]["password"]`), never interpolated
  as a literal. `{ kind: "random", generator }` renders as a call into
  `utils/random_data.py` (e.g. `random_data.full_name()`), generated once at import
  time if `seedOnce`, or called fresh per test run otherwise.
- **Assertions** use `expect(locator).to_be_visible()` etc. (Playwright's
  auto-retrying assertions), never a bare `assert` on a snapshot value, so generated
  tests aren't flaky by construction.
- **conftest.py** is only ever *created* if absent; if present and
  `source_origin === "manually_modified"` for the project's conftest, the generator
  skips touching it and surfaces a warning instead of overwriting hand-written
  fixtures.

### Example output (abbreviated, matches `TEST_MODEL.md`'s example)

```python
# pages/search_provider_page.py
from playwright.sync_api import Page, expect

class SearchProviderPage:
    def __init__(self, page: Page):
        self.page = page
        self.username = page.get_by_role("textbox", name="Username")
        self.password = page.get_by_role("textbox", name="Password")
        self.login_button = page.get_by_role("button", name="Login")

    def login(self, username: str, password: str) -> None:
        self.username.fill(username)
        self.password.fill(password)
        self.login_button.click()
```

```python
# tests/smoke/test_search_provider.py
import pytest
from pages.search_provider_page import SearchProviderPage

@pytest.mark.bvt
@pytest.mark.smoke
@pytest.mark.regression
def test_search_provider(page, env, creds):
    page.goto(env["base_url"])
    search_provider_page = SearchProviderPage(page)
    search_provider_page.login(creds["default"]["username"], creds["default"]["password"])
    expect(page.get_by_text("Dashboard")).to_be_visible()
```

## Future adapters (interface only, not implemented in Phase 1)

`SeleniumPythonPytestGenerator`, `SeleniumJavaTestNGGenerator`,
`SeleniumJavaCucumberGenerator`, `PlaywrightJavaGenerator`,
`PlaywrightCSharpNUnitGenerator`, `SeleniumCSharpNUnitGenerator`,
`RobotFrameworkGenerator` all implement the same `CodeGeneratorAdapter` interface.
The `framework_configs` table (`DATA_MODEL.md`) drives which combinations the UI
offers versus shows as "Coming Soon" — adding a stack is "implement the adapter +
flip `is_available`", not a UI change.
