import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { classifyFailure, locateFailingStep } from "../../electron/services/execution/PythonExecutionAdapter";

describe("classifyFailure", () => {
  it("classifies a Playwright strict-mode violation as a locator failure", () => {
    expect(classifyFailure("Error: strict mode violation: locator resolved to 2 elements")).toBe("locator");
  });

  it("classifies a timeout message as a timeout failure", () => {
    expect(classifyFailure("Timeout 30000ms exceeded waiting for locator")).toBe("timeout");
  });

  it("classifies an AssertionError as an assertion failure", () => {
    expect(classifyFailure("AssertionError: Locator expected to have text 'Dashboard'")).toBe("assertion");
  });

  it("classifies a DNS/connection error as an environment failure", () => {
    expect(classifyFailure("net::ERR_CONNECTION_REFUSED at https://tst.example.com")).toBe("environment");
  });

  it("falls back to unknown for an unrecognized message", () => {
    expect(classifyFailure("Something completely unexpected happened")).toBe("unknown");
  });

  it("classifies a DNS failure inside a login_flow() call as environment, not auth (regression: bare 'login' substring false positive)", () => {
    // Caught via a real pytest run: a DNS failure whose traceback merely
    // passes through a generated method named "login_flow" was previously
    // misclassified as "auth" because the old check did `message.includes("login")`.
    const message = [
      "pages\\search_provider_page.py:18: in login_flow",
      "    self.page.goto(env[\"base_url\"])",
      "playwright._impl._errors.Error: Page.goto: net::ERR_NAME_NOT_RESOLVED at https://tst.example.com/",
    ].join("\n");
    expect(classifyFailure(message)).toBe("environment");
  });

  it("still classifies a real 401/invalid-credentials failure as auth", () => {
    expect(classifyFailure("Error: Request failed with status code 401 Unauthorized")).toBe("auth");
    expect(classifyFailure("AssertionError: invalid credentials")).toBe("assertion");
  });

  it("regression: a plain Locator.fill() timeout is classified as timeout, not environment — the full traceback passes through Playwright's own playwright._impl._connection module on its way to raising TimeoutError, and a bare .includes('connection') check previously matched that internal module name every time, regardless of what actually failed", () => {
    // Trimmed from a real run: an element that never appeared timed out,
    // and the UI showed 'A network/connection problem... check the
    // environment's base URL' — actively misleading, since the real cause
    // had nothing to do with connectivity.
    const message = [
      "pages\\nl_builder_check_2_page.py:34: in username_flow",
      '    self.username.fill("tomsmith")',
      "...\\playwright\\sync_api\\_generated.py:18030: in fill",
      "    self._sync(",
      "...\\playwright\\_impl\\_locator.py:216: in fill",
      "    return await self._frame.fill(self._selector, strict=True, **params)",
      "...\\playwright\\_impl\\_connection.py:69: in send",
      "    return await self._connection.wrap_api_call(",
      "self = <playwright._impl._connection.Connection object at 0x0000022AF5A11FD0>",
      "E           playwright._impl._errors.TimeoutError: Locator.fill: Timeout 30000ms exceeded.",
      "E           Call log:",
      'E             - waiting for get_by_text("Username")',
    ].join("\n");
    expect(classifyFailure(message)).toBe("timeout");
  });

  it("still classifies an actual connection-refused failure as environment even without the 'net::err' prefix", () => {
    expect(classifyFailure("Error: connect ECONNREFUSED 127.0.0.1:9333")).toBe("environment");
    expect(classifyFailure("requests.exceptions.ConnectionError: Connection refused")).toBe("environment");
  });
});

describe("locateFailingStep", () => {
  let projectDir: string;

  afterEach(() => {
    if (projectDir) fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("traces a real pytest traceback back to the '# STEP n: ...' marker comment nearest the failing line, matching exactly what the generator emits", () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "aas-failstep-test-"));
    fs.mkdirSync(path.join(projectDir, "pages"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "pages", "location_new_fix_1_page.py"),
      [
        "class LocationNewFix1Page:",
        "    def location_name_flow(self, env, creds):",
        '        # STEP 4: click "Add" (role)',
        "        self.add_button.click()",
        '        # STEP 5: hover "div#content > ul > li:nth-of-type(2)" (css)',
        "        self.div_table_tbody_tr_nth_of_type_2.hover()",
        "",
      ].join("\n"),
      "utf8"
    );

    // A real (trimmed) pytest longrepr for a strict-mode-violation failure —
    // the exact shape reported live: the deepest frame inside OUR generated
    // page object, then Playwright's own internals below it.
    const traceback = [
      "tests/uncategorized/test_location_new_fix_1.py:10: in test_test_location_new_fix_1",
      "    test_location_new_fix_1_page.location_name_flow(env, creds)",
      "pages\\location_new_fix_1_page.py:6: in location_name_flow",
      "    self.div_table_tbody_tr_nth_of_type_2.hover()",
      "C:\\...\\playwright\\sync_api\\_generated.py:19160: in hover",
      "    self._sync(...)",
      "playwright._impl._errors.Error: Locator.hover: Error: strict mode violation: locator resolved to 3 elements",
    ].join("\n");

    const result = locateFailingStep(traceback, projectDir);
    expect(result).toEqual({ stepIndex: 5, description: 'hover "div#content > ul > li:nth-of-type(2)" (css)' });
  });

  it("returns null when the traceback has no frame inside a generated _page.py file (e.g. a fixture/setup-level failure)", () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "aas-failstep-test-"));
    const traceback = "conftest.py:42: in creds\n    raise KeyError('default')\nKeyError: 'default'";
    expect(locateFailingStep(traceback, projectDir)).toBeNull();
  });

  it("returns null (not a crash) when the referenced page object file doesn't exist on disk", () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "aas-failstep-test-"));
    const traceback = "pages\\missing_page.py:6: in some_flow\n    self.x.click()";
    expect(locateFailingStep(traceback, projectDir)).toBeNull();
  });

  it("never reads a path outside the project directory, even if the traceback names one via '..'", () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "aas-failstep-test-"));
    // A file that does exist, but only by escaping the project directory —
    // must not be read even though it technically matches the file-path pattern.
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "aas-failstep-outside-"));
    fs.writeFileSync(path.join(outsideDir, "secret_page.py"), "# STEP 1: click \"x\" (role)\nx()\n", "utf8");
    const relEscape = path.relative(projectDir, path.join(outsideDir, "secret_page.py"));
    const traceback = `${relEscape}:2: in some_flow\n    x()`;
    expect(locateFailingStep(traceback, projectDir)).toBeNull();
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });
});
