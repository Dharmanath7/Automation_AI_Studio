import { describe, it, expect } from "vitest";
import { generateRandomValue, generateBoundaryValue } from "../../electron/shared/randomData";

describe("randomData", () => {
  it("expands a custom pattern using # for digits and ? for letters", () => {
    const value = generateRandomValue("customPattern", "##-??-##");
    expect(value).toMatch(/^\d{2}-[a-z]{2}-\d{2}$/);
  });

  it("generates a plausible email address", () => {
    const value = generateRandomValue("email");
    expect(value).toMatch(/^[a-z]+\.[a-z0-9]+@example\.com$/);
  });

  it("generates a garbage-looking string (lowercase letters + trailing digits), not a realistic word", () => {
    // Regression: "randomString" is the default generator when a field is
    // marked Random — it should read as obvious junk data (matching the
    // style of a real generated value, e.g. "ihabscjhbajchs8812"), not
    // something that could pass for a genuine value.
    const value = generateRandomValue("randomString");
    expect(value).toMatch(/^[a-z]{8,14}[0-9]{2,4}$/);
  });

  describe("generateBoundaryValue", () => {
    it("returns an empty string for the empty boundary", () => {
      expect(generateBoundaryValue("empty")).toBe("");
    });
    it("returns a string at least maxLength+1 characters for maxLengthPlusOne", () => {
      expect(generateBoundaryValue("maxLengthPlusOne", 10)).toHaveLength(11);
    });
    it("returns unicode characters for the unicode boundary", () => {
      expect(generateBoundaryValue("unicode")).toContain("测试");
    });
  });
});
