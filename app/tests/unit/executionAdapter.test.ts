import { describe, it, expect } from "vitest";
import { classifyFailure } from "../../electron/services/execution/PythonExecutionAdapter";

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
});
