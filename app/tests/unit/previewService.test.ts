import { describe, it, expect, vi } from "vitest";
import os from "node:os";
import type { Page } from "playwright";
import type { LocatorCandidate, StepTarget, TestStep } from "../../electron/shared/testModel";

vi.mock("electron", () => ({
  app: { getPath: () => os.tmpdir() },
}));

const {
  resolvePreviewValue,
  buildLocator,
  resolveLocator,
  runStep,
  candidateLabel,
} = await import("../../electron/services/preview/previewService");
type PreviewEnv = import("../../electron/services/preview/previewService").PreviewEnv;

const ENV: PreviewEnv = { base_url: "https://tst.example.com", api_url: "https://api.example.com" };

function candidate(strategy: LocatorCandidate["strategy"], value: string, roleName?: string): LocatorCandidate {
  return { strategy, value, roleName, quality: "fair" };
}

/** Minimal fake Locator — only the surface previewService actually calls. */
class FakeLocator {
  calls: string[] = [];
  filledWith?: string;
  selectedWith?: string;
  visible = true;

  constructor(
    private matchCount: number,
    opts: { visible?: boolean; throwOn?: string[] } = {},
  ) {
    this.visible = opts.visible ?? true;
    this.throwOn = opts.throwOn ?? [];
  }
  private throwOn: string[];

  private guard(action: string) {
    this.calls.push(action);
    if (this.throwOn.includes(action)) throw new Error(`${action} failed\nsecond line of stack`);
  }

  async count() {
    return this.matchCount;
  }
  first() {
    return this;
  }
  async click() {
    this.guard("click");
  }
  async dblclick() {
    this.guard("dblclick");
  }
  async hover() {
    this.guard("hover");
  }
  async check() {
    this.guard("check");
  }
  async uncheck() {
    this.guard("uncheck");
  }
  async fill(text: string) {
    this.guard("fill");
    this.filledWith = text;
  }
  async selectOption(text: string) {
    this.guard("selectOption");
    this.selectedWith = text;
  }
  async isVisible() {
    return this.visible;
  }
}

/** Minimal fake Page — a registry keyed by "strategy:value[:roleName]" resolves to a FakeLocator. */
class FakePage {
  gotoCalls: Array<{ url: string; opts?: unknown }> = [];
  pressed: string[] = [];
  wheeled = false;
  private registry: Map<string, FakeLocator>;

  constructor(entries: Record<string, FakeLocator> = {}) {
    this.registry = new Map(Object.entries(entries));
  }

  private lookup(key: string): FakeLocator {
    const found = this.registry.get(key);
    if (found) return found;
    if (key.startsWith("css:throw:") || key.startsWith("xpath=throw")) {
      throw new Error("invalid selector");
    }
    return new FakeLocator(0);
  }

  getByRole(role: string, opts?: { name?: string }) {
    return this.lookup(`role:${role}:${opts?.name ?? ""}`);
  }
  getByTestId(v: string) {
    return this.lookup(`testId:${v}`);
  }
  getByLabel(v: string) {
    return this.lookup(`label:${v}`);
  }
  getByPlaceholder(v: string) {
    return this.lookup(`placeholder:${v}`);
  }
  getByText(v: string) {
    return this.lookup(`text:${v}`);
  }
  locator(v: string) {
    if (v.startsWith("xpath=throw")) throw new Error("invalid xpath");
    return this.lookup(`css:${v}`);
  }
  async goto(url: string, opts?: unknown) {
    this.gotoCalls.push({ url, opts });
  }
  async goBack() {}
  async goForward() {}
  async reload() {}
  keyboard = {
    press: async (k: string) => {
      this.pressed.push(k);
    },
  };
  mouse = {
    wheel: async () => {
      this.wheeled = true;
    },
  };
}

function baseStep(overrides: Partial<TestStep>): TestStep {
  return { id: "s1", type: "click", enabled: true, ...overrides };
}

describe("resolvePreviewValue", () => {
  it("returns a literal value as-is", () => {
    expect(resolvePreviewValue({ kind: "literal", value: "hello" }, ENV)).toEqual({ text: "hello" });
  });

  it("resolves the base_url variable from the environment", () => {
    expect(resolvePreviewValue({ kind: "variable", path: "base_url" }, ENV)).toEqual({ text: ENV.base_url });
  });

  it("substitutes an obvious placeholder for a Credential Vault variable, with an explanatory note (never decrypts real credentials for a throwaway preview run)", () => {
    const result = resolvePreviewValue({ kind: "variable", path: "credentials.default.password" }, ENV);
    expect(result.text).toMatch(/preview/i);
    expect(result.note).toMatch(/placeholder/i);
  });

  it("resolves an arbitrary env variable by path, falling back to empty string when absent", () => {
    expect(resolvePreviewValue({ kind: "variable", path: "api_url" }, ENV)).toEqual({ text: ENV.api_url });
    expect(resolvePreviewValue({ kind: "variable", path: "missing_key" }, ENV)).toEqual({ text: "" });
  });

  it("generates a random value for a random TestValue", () => {
    const result = resolvePreviewValue({ kind: "random", generator: "uuid", seedOnce: false }, ENV);
    expect(result.text).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("generates a boundary value for a boundary TestValue", () => {
    expect(resolvePreviewValue({ kind: "boundary", boundary: "empty" }, ENV).text).toBe("");
  });

  it("returns an empty string when no value is given", () => {
    expect(resolvePreviewValue(undefined, ENV)).toEqual({ text: "" });
  });
});

describe("buildLocator", () => {
  it("dispatches each strategy to the matching Playwright locator method", () => {
    const page = new FakePage({
      "role:button:Submit": new FakeLocator(1),
      "testId:save-btn": new FakeLocator(1),
      "label:Username": new FakeLocator(1),
      "placeholder:Search...": new FakeLocator(1),
      "text:Click me": new FakeLocator(1),
      "css:.foo": new FakeLocator(1),
    });
    expect(buildLocator(page as unknown as Page, candidate("role", "button", "Submit"))).toBeInstanceOf(FakeLocator);
    expect(buildLocator(page as unknown as Page, candidate("testId", "save-btn"))).toBeInstanceOf(FakeLocator);
    expect(buildLocator(page as unknown as Page, candidate("label", "Username"))).toBeInstanceOf(FakeLocator);
    expect(buildLocator(page as unknown as Page, candidate("placeholder", "Search..."))).toBeInstanceOf(FakeLocator);
    expect(buildLocator(page as unknown as Page, candidate("text", "Click me"))).toBeInstanceOf(FakeLocator);
    expect(buildLocator(page as unknown as Page, candidate("css", ".foo"))).toBeInstanceOf(FakeLocator);
  });

  it("prefixes xpath candidates with 'xpath=' when building the css/xpath fallback locator", () => {
    const page = new FakePage({ "css:xpath=//button": new FakeLocator(1) });
    const loc = buildLocator(page as unknown as Page, candidate("xpath", "//button"));
    expect(loc).toBeInstanceOf(FakeLocator);
  });
});

describe("resolveLocator", () => {
  it("returns the preferred candidate when it matches on the live page", () => {
    const preferred = candidate("label", "Username");
    const alt = candidate("text", "Username");
    const target: StepTarget = { preferred, alternatives: [alt] };
    const page = new FakePage({ "label:Username": new FakeLocator(1) });

    return resolveLocator(page as unknown as Page, target).then((result) => {
      expect(result?.candidate).toBe(preferred);
    });
  });

  it("falls back to the first matching alternative when the preferred candidate finds nothing", async () => {
    const preferred = candidate("label", "Username");
    const alt = candidate("text", "Username");
    const target: StepTarget = { preferred, alternatives: [alt] };
    const page = new FakePage({ "text:Username": new FakeLocator(1) });

    const result = await resolveLocator(page as unknown as Page, target);
    expect(result?.candidate).toBe(alt);
  });

  it("narrows to .first() when a candidate matches more than one element", async () => {
    const preferred = candidate("text", "Submit");
    const target: StepTarget = { preferred, alternatives: [] };
    const many = new FakeLocator(3);
    const page = new FakePage({ "text:Submit": many });

    const result = await resolveLocator(page as unknown as Page, target);
    expect(result?.locator).toBe(many);
  });

  it("skips a malformed candidate (e.g. invalid xpath) and tries the next one", async () => {
    const preferred = candidate("xpath", "throw(((");
    const alt = candidate("label", "Username");
    const target: StepTarget = { preferred, alternatives: [alt] };
    const page = new FakePage({ "label:Username": new FakeLocator(1) });

    const result = await resolveLocator(page as unknown as Page, target);
    expect(result?.candidate).toBe(alt);
  });

  it("returns null when no candidate matches anything", async () => {
    const target: StepTarget = { preferred: candidate("label", "Nope"), alternatives: [] };
    const page = new FakePage();
    expect(await resolveLocator(page as unknown as Page, target)).toBeNull();
  });

  it("returns null when there is no target at all", async () => {
    const page = new FakePage();
    expect(await resolveLocator(page as unknown as Page, undefined)).toBeNull();
  });
});

describe("candidateLabel", () => {
  it("prefers the role name when present", () => {
    expect(candidateLabel(candidate("role", "button", "Submit"))).toBe('role="Submit"');
  });
  it("falls back to the raw value otherwise", () => {
    expect(candidateLabel(candidate("label", "Username"))).toBe('label="Username"');
  });
});

describe("runStep", () => {
  it("navigates using the resolved value and reports passed", async () => {
    const page = new FakePage();
    const step = baseStep({ type: "navigate", value: { kind: "literal", value: "https://google.com" } });
    const result = await runStep(page as unknown as Page, step, ENV);
    expect(result.status).toBe("passed");
    expect(page.gotoCalls[0].url).toBe("https://google.com");
  });

  it("fails with a clear message when a click target matches nothing on the page", async () => {
    const page = new FakePage();
    const step = baseStep({ type: "click", target: { preferred: candidate("text", "Ghost button"), alternatives: [] } });
    const result = await runStep(page as unknown as Page, step, ENV);
    expect(result.status).toBe("failed");
    expect(result.message).toMatch(/no element/i);
  });

  it("fills a matched field with the resolved literal value and reports which strategy matched", async () => {
    const page = new FakePage({ "label:Username": new FakeLocator(1) });
    const step = baseStep({
      type: "fill",
      target: { preferred: candidate("label", "Username"), alternatives: [] },
      value: { kind: "literal", value: "DharmaPhynd" },
    });
    const result = await runStep(page as unknown as Page, step, ENV);
    expect(result.status).toBe("passed");
    expect(result.matchedStrategy).toBe('label="Username"');
  });

  it("fills a password field with the Credential Vault placeholder and surfaces the note as the step message", async () => {
    const page = new FakePage({ "label:Password": new FakeLocator(1) });
    const step = baseStep({
      type: "fill",
      target: { preferred: candidate("label", "Password"), alternatives: [] },
      value: { kind: "variable", path: "credentials.default.password" },
    });
    const result = await runStep(page as unknown as Page, step, ENV);
    expect(result.status).toBe("passed");
    expect(result.message).toMatch(/placeholder/i);
  });

  it("treats an assert-visible step as passed when the matched element is visible", async () => {
    const page = new FakePage({ "text:Grid": new FakeLocator(1, { visible: true }) });
    const step = baseStep({
      type: "assert",
      target: { preferred: candidate("text", "Grid"), alternatives: [] },
      assertion: { type: "visible" },
    });
    const result = await runStep(page as unknown as Page, step, ENV);
    expect(result.status).toBe("passed");
  });

  it("fails an assert-visible step when the element is found but not visible", async () => {
    const page = new FakePage({ "text:Grid": new FakeLocator(1, { visible: false }) });
    const step = baseStep({
      type: "assert",
      target: { preferred: candidate("text", "Grid"), alternatives: [] },
      assertion: { type: "visible" },
    });
    const result = await runStep(page as unknown as Page, step, ENV);
    expect(result.status).toBe("failed");
    expect(result.message).toMatch(/not visible/i);
  });

  it("skips assertion types other than 'visible' during preview, with an explanatory message", async () => {
    const page = new FakePage({ "text:Grid": new FakeLocator(1) });
    const step = baseStep({
      type: "assert",
      target: { preferred: candidate("text", "Grid"), alternatives: [] },
      assertion: { type: "textEquals", expected: { kind: "literal", value: "Grid" } },
    });
    const result = await runStep(page as unknown as Page, step, ENV);
    expect(result.status).toBe("skipped");
    expect(result.message).toMatch(/textEquals/);
  });

  it("skips step types that preview doesn't execute yet (e.g. upload)", async () => {
    const page = new FakePage();
    const step = baseStep({ type: "upload" });
    const result = await runStep(page as unknown as Page, step, ENV);
    expect(result.status).toBe("skipped");
    expect(result.message).toMatch(/isn't executed/);
  });

  it("catches a mid-action Playwright error and reports failed with just the first line of the message", async () => {
    const page = new FakePage({ "text:Flaky": new FakeLocator(1, { throwOn: ["click"] }) });
    const step = baseStep({ type: "click", target: { preferred: candidate("text", "Flaky"), alternatives: [] } });
    const result = await runStep(page as unknown as Page, step, ENV);
    expect(result.status).toBe("failed");
    expect(result.message).toBe("click failed");
  });

  it("presses a key using the resolved value", async () => {
    const page = new FakePage();
    const step = baseStep({ type: "pressKey", value: { kind: "literal", value: "Enter" } });
    const result = await runStep(page as unknown as Page, step, ENV);
    expect(result.status).toBe("passed");
    expect(page.pressed).toEqual(["Enter"]);
  });
});
