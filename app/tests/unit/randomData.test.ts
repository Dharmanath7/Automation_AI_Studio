import { describe, it, expect, vi, afterEach } from "vitest";
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
    // style of a real generated value, e.g. "ihabsc84213765"), not
    // something that could pass for a genuine value.
    const value = generateRandomValue("randomString");
    expect(value).toMatch(/^[a-z]{6,10}[0-9]{8}$/);
  });

  describe("randomString uniqueness across separate calls/runs", () => {
    afterEach(() => vi.restoreAllMocks());

    it("regression: the trailing digits actually track the clock, not just random.choices() — so values generated at genuinely different times (e.g. separate test runs) can never collide even if the random letters happen to match", () => {
      vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_123);
      const a = generateRandomValue("randomString");
      vi.spyOn(Date, "now").mockReturnValue(1_700_000_005_456);
      const b = generateRandomValue("randomString");
      expect(a.slice(-8)).not.toBe(b.slice(-8));
    });
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
