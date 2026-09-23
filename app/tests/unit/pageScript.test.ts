import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RECORDER_INIT_SCRIPT } from "../../electron/services/recorder/pageScript";

describe("RECORDER_INIT_SCRIPT", () => {
  it("is syntactically valid JavaScript (catches TS-template-literal string bugs static typecheck alone can miss for callers that don't run tsc)", () => {
    // RECORDER_INIT_SCRIPT is authored as a giant TS template literal that's
    // injected into the recorded page as a raw string via addInitScript() —
    // never parsed by TypeScript itself. A stray un-escaped backtick or `${`
    // inside a comment silently truncates the exported string instead of
    // erroring here; tsc only catches it because the truncation happens to
    // also break the *enclosing* .ts file's own syntax, which won't always
    // be true. Actually executing the extracted string as JS is the only
    // thing that verifies the runtime payload is what was intended.
    expect(() => new Function(RECORDER_INIT_SCRIPT)).not.toThrow();
  });

  it("contains the hover, click, and CSS-:hover-rule detection logic (regression guard against accidental truncation)", () => {
    expect(RECORDER_INIT_SCRIPT).toContain("hasHoverStyleRule");
    expect(RECORDER_INIT_SCRIPT).toContain("HOVER_DWELL_MS");
    expect(RECORDER_INIT_SCRIPT).toContain("addEventListener('mouseover'");
    expect(RECORDER_INIT_SCRIPT).toContain("addEventListener('click'");
    expect(RECORDER_INIT_SCRIPT).toContain("flashHighlight");
  });

  it("regression: the whitespace-splitting regex survives the outer template literal's escape processing as \\s+, not s+", () => {
    // A single un-doubled backslash (`/\s+/` instead of `/\\s+/`) inside this
    // outer .ts template literal is a *silent* escape-collapse: TypeScript
    // drops the backslash for the unrecognized `\s` escape, so the compiled
    // runtime string contains the regex `/s+/` (matches literal "s"
    // characters) instead of `/\s+/` (matches whitespace). Both are valid
    // JS — `new Function(...)` above does not catch this — so only a direct
    // string/behavioral check does. This exact bug silently broke hover
    // detection for any selector with no "s" in it (e.g. ".figure:hover"),
    // found only by driving hover interactions against the real built app.
    expect(RECORDER_INIT_SCRIPT).toContain("split(/\\s+/)");
  });

  describe("hover detection against a real CSS :hover rule (jsdom)", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
      vi.useRealTimers();
      document.body.innerHTML = "";
      document.head.innerHTML = "";
      // @ts-expect-error test-only reset of the recorder's page-level install guard
      delete window.__aasRecorderInstalled;
    });

    it("detects a hover-reveal <div> whose visibility is driven purely by a 'TRIGGER:hover TARGET' CSS rule (not a role/tag whitelist), exactly like the real-world case that failed (the-internet.herokuapp.com's .figure:hover .figcaption)", () => {
      const style = document.createElement("style");
      style.textContent = ".figure { cursor: default; } .figure .figcaption { display: none; } .figure:hover .figcaption { display: block; }";
      document.head.appendChild(style);

      const figure = document.createElement("div");
      figure.className = "figure";
      figure.innerHTML = '<div class="figcaption">revealed on hover</div>';
      document.body.appendChild(figure);

      const events: unknown[] = [];
      // @ts-expect-error test-only stub of the binding recorderService.ts normally exposes via Playwright's exposeBinding
      window.__aasRecordEvent = (action: unknown) => events.push(action);

      new Function(RECORDER_INIT_SCRIPT)();

      figure.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      vi.advanceTimersByTime(600); // past HOVER_DWELL_MS (500ms)

      expect(events).toEqual([{ kind: "hover", locator: expect.objectContaining({ strategy: "css" }) }]);
    });
  });
});
