import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { RECORDER_INIT_SCRIPT } from "../../electron/services/recorder/pageScript";

/**
 * RECORDER_INIT_SCRIPT guards itself with `if (window.__aasRecorderInstalled)
 * return;` — correct for real usage (one install per page navigation), but
 * it means calling `new Function(RECORDER_INIT_SCRIPT)()` again in a later
 * test, against the SAME shared jsdom `document` vitest reuses across `it()`
 * blocks in one file, either no-ops (if the flag survives) or, if a test
 * deletes the flag to force reinstallation, leaves the FIRST test's
 * `document`-level event listeners still attached (clearing
 * `body.innerHTML` doesn't detach listeners bound to `document` itself) —
 * so two independent listener copies both fire on the same event. Installing
 * exactly once for the whole file sidesteps both failure modes.
 */
beforeAll(() => {
  new Function(RECORDER_INIT_SCRIPT)();
});

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

      figure.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      vi.advanceTimersByTime(600); // past HOVER_DWELL_MS (500ms)

      expect(events).toEqual([{ kind: "hover", locator: expect.objectContaining({ strategy: "css" }) }]);
    });
  });

  describe("CSS-fallback locator uniqueness (jsdom)", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
      vi.useRealTimers();
      document.body.innerHTML = "";
    });

    it("regression: a 4-level fallback path like 'div > table > tbody > tr:nth-of-type(2)' that matches multiple repeated tables is deepened until it uniquely identifies the hovered row, instead of producing a locator Playwright's own strict mode rejects as ambiguous", () => {
      // Reproduces the exact reported failure verbatim: hovering a <tr>
      // with no id/role/label (a table row has neither by default —
      // computeLocator() falls all the way through to the CSS fallback)
      // produced a path only 4 levels deep — div > table > tbody >
      // tr:nth-of-type(2) — which ALSO matched the 2nd row of every other
      // structurally-identical table on the page. Playwright's .hover()
      // refuses to act on a locator matching more than one element
      // ("strict mode violation"), and no amount of waiting fixes that,
      // since it isn't a timing problem.
      for (let i = 0; i < 3; i++) {
        const wrapper = document.createElement("div");
        wrapper.className = "panel";
        wrapper.innerHTML =
          '<div><table><tbody><tr data-hover="1"><td>a</td></tr><tr data-hover="1"><td>row-' + i + "</td></tr></tbody></table></div>";
        document.body.appendChild(wrapper);
      }

      const events: unknown[] = [];
      // @ts-expect-error test-only stub of the binding recorderService.ts normally exposes via Playwright's exposeBinding
      window.__aasRecordEvent = (action: unknown) => events.push(action);

      // The 2nd row of the 2nd table specifically — same relative position
      // (tr:nth-of-type(2)) as the identical rows in tables 1 and 3, and
      // structurally identical up to 4 levels: div > table > tbody > tr.
      const targetRow = document.querySelectorAll(".panel")[1].querySelectorAll("tr")[1];
      targetRow.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      vi.advanceTimersByTime(600); // past HOVER_DWELL_MS (500ms)

      expect(document.querySelectorAll("div > table > tbody > tr:nth-of-type(2)")).toHaveLength(3); // sanity: the naive 4-level path really is ambiguous here

      expect(events).toHaveLength(1);
      const locator = (events[0] as { kind: string; locator: { strategy: string; value: string } }).locator;
      expect(locator.strategy).toBe("css");
      expect(document.querySelectorAll(locator.value)).toHaveLength(1);
      expect(document.querySelectorAll(locator.value)[0]).toBe(targetRow);
    });
  });
});
