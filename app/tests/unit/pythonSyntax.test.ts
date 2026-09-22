import { describe, it, expect } from "vitest";
import { toSnakeCase, toPascalCase, toPythonIdentifier } from "../../electron/services/codegen/pythonSyntax";

describe("toSnakeCase", () => {
  it("keeps an all-caps acronym/word intact instead of shattering it letter by letter", () => {
    // Regression: the old implementation split before every uppercase
    // letter, so "DEMO1" became "d_e_m_o1" — this is exactly the garbled
    // "health_plan_create_d_e_m_o1_page" name a user hit in practice.
    expect(toSnakeCase("DEMO1")).toBe("demo1");
    expect(toSnakeCase("Health Plan Create DEMO1")).toBe("health_plan_create_demo1");
    expect(toSnakeCase("URL")).toBe("url");
    expect(toSnakeCase("Login to APP")).toBe("login_to_app");
  });

  it("still splits camelCase / PascalCase words normally", () => {
    expect(toSnakeCase("SearchProvider")).toBe("search_provider");
    expect(toSnakeCase("viewDetails")).toBe("view_details");
  });

  it("splits an acronym immediately followed by a new titlecased word", () => {
    expect(toSnakeCase("XMLHttpRequest")).toBe("xml_http_request");
  });

  it("handles space-separated names unchanged in meaning", () => {
    expect(toSnakeCase("Search Provider")).toBe("search_provider");
    expect(toSnakeCase("View Details")).toBe("view_details");
    expect(toSnakeCase("Username")).toBe("username");
    expect(toSnakeCase("Login")).toBe("login");
  });

  it("collapses punctuation and repeated separators without leaving stray underscores", () => {
    expect(toSnakeCase("  Search --- Provider!!  ")).toBe("search_provider");
  });

  it("falls back to 'unnamed' for input with no alphanumeric characters", () => {
    expect(toSnakeCase("!!!")).toBe("unnamed");
  });
});

describe("toPascalCase", () => {
  it("keeps acronyms readable rather than mangling them", () => {
    expect(toPascalCase("Health Plan Create DEMO1")).toBe("HealthPlanCreateDEMO1");
  });
});

describe("toPythonIdentifier", () => {
  it("produces a valid identifier that never starts with a digit", () => {
    expect(toPythonIdentifier("DEMO1")).toBe("demo1");
    expect(toPythonIdentifier("123")).toBe("_123");
  });
});
