import { describe, it, expect } from "vitest";
import { parseInstructionsToSteps } from "../../electron/shared/naturalLanguageSteps";

describe("parseInstructionsToSteps", () => {
  it("parses a full multi-step flow end to end: navigate, click, fill, random value, select, hover, verify", () => {
    const { steps, warnings } = parseInstructionsToSteps(`
      Go to https://example.com/signup
      Click on the Login button
      Fill Username with John
      Add random value in Health Plan Name
      Select Gold from Plan Type dropdown
      Hover over the Account menu
      Verify Welcome message is visible
    `);

    expect(warnings).toEqual([]);
    expect(steps.map((s) => s.type)).toEqual(["navigate", "click", "fill", "fill", "select", "hover", "assert"]);
  });

  describe("navigate", () => {
    it("recognizes go to / navigate to / open / visit with a real URL as a literal value", () => {
      for (const line of ["Go to https://example.com", "Navigate to https://example.com", "Open https://example.com", "Visit https://example.com"]) {
        const { steps } = parseInstructionsToSteps(line);
        expect(steps[0].type).toBe("navigate");
        expect(steps[0].value).toEqual({ kind: "literal", value: "https://example.com" });
      }
    });

    it("falls back to {{base_url}} when the destination isn't a real URL (e.g. 'the website')", () => {
      const { steps } = parseInstructionsToSteps("Go to the website");
      expect(steps[0].value).toEqual({ kind: "variable", path: "base_url" });
    });

    it("accepts a bare www. domain and normalizes it to https://", () => {
      const { steps } = parseInstructionsToSteps("Go to www.example.com");
      expect(steps[0].value).toEqual({ kind: "literal", value: "https://www.example.com" });
    });

    it("regression: also normalizes a bare domain with no 'www.' prefix (e.g. 'google.com') — Playwright's page.goto() rejects a protocol-less string outright ('Cannot navigate to invalid URL'), caught live with 'Go to google.com'", () => {
      const { steps } = parseInstructionsToSteps("Go to google.com");
      expect(steps[0].value).toEqual({ kind: "literal", value: "https://google.com" });
    });
  });

  describe("click / doubleClick", () => {
    it("parses 'Click on X', 'Click X', 'Press X', 'Tap X'", () => {
      for (const line of ["Click on the Submit button", "Click the Submit button", "Press the Submit button", "Tap the Submit button"]) {
        const { steps } = parseInstructionsToSteps(line);
        expect(steps[0].type).toBe("click");
        expect(steps[0].target?.preferred).toEqual({ strategy: "role", value: "button", roleName: "Submit", quality: "fair" });
      }
    });

    it("parses double click distinctly from click", () => {
      const { steps } = parseInstructionsToSteps("Double click the Edit icon");
      expect(steps[0].type).toBe("doubleClick");
    });

    it("falls back to a text-strategy locator when there's no recognized role word", () => {
      const { steps } = parseInstructionsToSteps("Click on Login");
      expect(steps[0].target?.preferred).toEqual({ strategy: "text", value: "Login", quality: "fragile" });
    });

    it("routes 'Press Enter'/'Press Tab' to a pressKey step, not a click on a target named 'Enter'", () => {
      const { steps } = parseInstructionsToSteps("Press Enter");
      expect(steps[0]).toMatchObject({ type: "pressKey", value: { kind: "literal", value: "Enter" } });
    });
  });

  describe("fill", () => {
    it("parses 'Fill X with Y', locating the target by label — get_by_text() would find the <label> element itself, which isn't fillable, so a fill target's fallback strategy is 'label', not 'text' (only click-like targets default to 'text')", () => {
      const { steps } = parseInstructionsToSteps("Fill Username with John");
      expect(steps[0]).toMatchObject({
        type: "fill",
        value: { kind: "literal", value: "John" },
      });
      expect(steps[0].target?.preferred.strategy).toBe("label");
      expect(steps[0].target?.preferred.value).toBe("Username");
    });

    it("parses 'Enter Y in X' / 'Type Y into X' (value and target swapped vs. 'Fill')", () => {
      const a = parseInstructionsToSteps("Enter John in the Username field").steps[0];
      expect(a.value).toEqual({ kind: "literal", value: "John" });
      expect(a.target?.preferred).toEqual({ strategy: "role", value: "textbox", roleName: "Username", quality: "fair" });

      const b = parseInstructionsToSteps("Type John into Username").steps[0];
      expect(b.value).toEqual({ kind: "literal", value: "John" });
    });

    it("strips surrounding quotes from a literal value", () => {
      const { steps } = parseInstructionsToSteps('Fill Username with "John Doe"');
      expect(steps[0].value).toEqual({ kind: "literal", value: "John Doe" });
    });
  });

  describe("random values — the specific feature requested: 'Add Random value' style phrasing", () => {
    it("parses the exact requested phrasing: 'Add Random value in <field>'", () => {
      const { steps } = parseInstructionsToSteps("Add Random value in Health Plan Name");
      expect(steps[0]).toMatchObject({
        type: "fill",
        value: { kind: "random", generator: "randomString", seedOnce: false },
      });
      expect(steps[0].target?.preferred.value).toBe("Health Plan Name");
    });

    it("also recognizes 'Fill X with a random value'", () => {
      const { steps } = parseInstructionsToSteps("Fill Health Plan Name with a random value");
      expect(steps[0].value).toEqual({ kind: "random", generator: "randomString", seedOnce: false });
      expect(steps[0].target?.preferred.value).toBe("Health Plan Name");
    });

    it("also recognizes 'X: random value' and 'X needs a random value'", () => {
      const a = parseInstructionsToSteps("Health Plan Name: random value").steps[0];
      expect(a.value).toEqual({ kind: "random", generator: "randomString", seedOnce: false });
      expect(a.target?.preferred.value).toBe("Health Plan Name");

      const b = parseInstructionsToSteps("Health Plan Name needs a random value").steps[0];
      expect(b.value).toEqual({ kind: "random", generator: "randomString", seedOnce: false });
    });

    it("regenerates a fresh value every run (seedOnce: false), same as the Test Editor's own Random default", () => {
      const { steps } = parseInstructionsToSteps("Add random value in Location Name");
      expect((steps[0].value as { seedOnce: boolean }).seedOnce).toBe(false);
    });
  });

  describe("select / hover / check / uncheck / assert", () => {
    it("parses 'Select X from Y' and 'Choose X in Y'", () => {
      const a = parseInstructionsToSteps("Select Gold from the Plan Type dropdown").steps[0];
      expect(a.type).toBe("select");
      expect(a.value).toEqual({ kind: "literal", value: "Gold" });
      expect(a.target?.preferred).toEqual({ strategy: "role", value: "combobox", roleName: "Plan Type", quality: "fair" });

      const b = parseInstructionsToSteps("Choose Gold in Plan Type").steps[0];
      expect(b.value).toEqual({ kind: "literal", value: "Gold" });
    });

    it("parses 'Hover over X' / 'Hover on X'", () => {
      const { steps } = parseInstructionsToSteps("Hover over the Account menu");
      expect(steps[0].type).toBe("hover");
    });

    it("parses 'Check X' and 'Uncheck X' as distinct step types", () => {
      const a = parseInstructionsToSteps("Check the Terms checkbox").steps[0];
      expect(a.type).toBe("check");
      const b = parseInstructionsToSteps("Uncheck the Terms checkbox").steps[0];
      expect(b.type).toBe("uncheck");
    });

    it("parses 'Verify X is visible' as an assert step", () => {
      const { steps } = parseInstructionsToSteps("Verify the Welcome banner is visible");
      expect(steps[0]).toMatchObject({ type: "assert", assertion: { type: "visible" } });
    });
  });

  describe("navigation shortcuts", () => {
    it("parses go back / go forward / refresh with no target needed", () => {
      expect(parseInstructionsToSteps("Go back").steps[0].type).toBe("goBack");
      expect(parseInstructionsToSteps("Go forward").steps[0].type).toBe("goForward");
      expect(parseInstructionsToSteps("Refresh the page").steps[0].type).toBe("refresh");
      expect(parseInstructionsToSteps("Reload").steps[0].type).toBe("refresh");
    });
  });

  describe("unparsed lines", () => {
    it("produces a warning naming the line number and text for input it doesn't recognize, rather than silently dropping or guessing", () => {
      const { steps, warnings } = parseInstructionsToSteps("Do the thing with the widget");
      expect(steps).toEqual([]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("Line 1");
      expect(warnings[0]).toContain("Do the thing with the widget");
    });

    it("skips blank lines without producing a warning for them", () => {
      const { steps, warnings } = parseInstructionsToSteps("Click on Login\n\n\nClick on Submit");
      expect(steps).toHaveLength(2);
      expect(warnings).toEqual([]);
    });

    it("continues parsing subsequent lines after an unparsed one", () => {
      const { steps, warnings } = parseInstructionsToSteps("gibberish line\nClick on Login");
      expect(steps).toHaveLength(1);
      expect(steps[0].type).toBe("click");
      expect(warnings).toHaveLength(1);
    });
  });

  it("every parsed step has a unique id and is enabled by default", () => {
    const { steps } = parseInstructionsToSteps("Click on Login\nClick on Submit");
    expect(steps[0].id).not.toBe(steps[1].id);
    expect(steps.every((s) => s.enabled)).toBe(true);
  });

  describe("regression: the exact real-world flow reported as failing", () => {
    const REAL_FLOW = [
      "Go to https://go.tst-phynd.com/Account/Login",
      'Enter the username as "DharmaPhynd"',
      "Click on Next",
      'Password as "Ubisoft@12"',
      "Hover on the HealthPlan section",
      "Click on Manage Healtplan",
      "Wait till the Grid loads",
      "Click on the ADD HEALTH PLAN",
      "Add a Random healthplan Name",
      "Add the same Healthplan external code under EXTERNAL CODE field",
      "Click on ADD button",
      "Wait till the Healthplan saves",
    ].join("\n");

    it("parses all 12 lines with zero warnings", () => {
      const { steps, warnings } = parseInstructionsToSteps(REAL_FLOW);
      expect(warnings).toEqual([]);
      expect(steps).toHaveLength(12);
      expect(steps.map((s) => s.type)).toEqual([
        "navigate", "fill", "click", "fill", "hover", "click",
        "assert", "click", "fill", "fill", "click", "assert",
      ]);
    });

    it("'Enter the username as X' fills a literal value located by label", () => {
      const { steps } = parseInstructionsToSteps('Enter the username as "DharmaPhynd"');
      expect(steps[0]).toMatchObject({ type: "fill", value: { kind: "literal", value: "DharmaPhynd" } });
      expect(steps[0].target?.preferred).toMatchObject({ strategy: "label", value: "username" });
    });

    it("'Password as X' (no leading verb) uses the Credential Vault, not the typed literal — a real password should never end up as plain text in the Test Model", () => {
      const { steps } = parseInstructionsToSteps('Password as "Ubisoft@12"');
      expect(steps[0]).toMatchObject({ type: "fill", value: { kind: "variable", path: "credentials.default.password" } });
      expect(steps[0].value).not.toMatchObject({ value: "Ubisoft@12" });
      expect(steps[0].note).toMatch(/credential vault/i);
    });

    it("'Wait till X loads/saves' becomes a visibility assertion on X — the app already waits automatically before every action, so this documents the expected checkpoint rather than generating a no-op 'wait' step", () => {
      const a = parseInstructionsToSteps("Wait till the Grid loads").steps[0];
      expect(a).toMatchObject({ type: "assert", assertion: { type: "visible" } });
      expect(a.target?.preferred.value).toBe("Grid");

      const b = parseInstructionsToSteps("Wait till the Healthplan saves").steps[0];
      expect(b).toMatchObject({ type: "assert", assertion: { type: "visible" } });
      expect(b.target?.preferred.value).toBe("Healthplan");
    });

    it("'Add a Random <field>' (no in/into/to/for connector) is recognized as a random fill", () => {
      const { steps } = parseInstructionsToSteps("Add a Random healthplan Name");
      expect(steps[0]).toMatchObject({ type: "fill", value: { kind: "random", generator: "randomString", seedOnce: false } });
      expect(steps[0].target?.preferred.value).toBe("healthplan Name");
    });

    it("'Add the same X under Y field' is treated as a random fill on Y, with a note explaining the Test Model can't exactly link it to a prior step's value", () => {
      const { steps } = parseInstructionsToSteps("Add the same Healthplan external code under EXTERNAL CODE field");
      expect(steps[0]).toMatchObject({ type: "fill", value: { kind: "random", generator: "randomString", seedOnce: false } });
      expect(steps[0].target?.preferred.value).toBe("EXTERNAL CODE");
      expect(steps[0].note).toMatch(/random value/i);
    });
  });
});
