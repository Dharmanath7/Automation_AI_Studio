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
      vi.advanceTimersByTime(1000); // past HOVER_DWELL_MS (500ms) + HOVER_EMIT_BUFFER_MS (450ms)

      expect(events).toEqual([{ kind: "hover", locator: expect.objectContaining({ strategy: "css" }) }]);
    });

    it("regression: detects a hover-reveal <div> with NO CSS :hover rule, no cursor:pointer, and no role at all — a purely JS-driven (e.g. React onMouseEnter) dropdown/tooltip, which the previous CSS/cursor-only heuristics missed entirely since there is no way to observe a React-delegated event handler from outside React", () => {
      const div = document.createElement("div");
      div.className = "menu-trigger";
      div.textContent = "Account";
      // jsdom doesn't compute real CSS layout, so getBoundingClientRect()
      // reports all-zero for every element unless stubbed — this gives it a
      // realistic bounded (non-zero, non-viewport-covering) size.
      div.getBoundingClientRect = () => ({ width: 120, height: 30, top: 10, left: 10, right: 130, bottom: 40, x: 10, y: 10, toJSON() {} });
      document.body.appendChild(div);

      const events: unknown[] = [];
      // @ts-expect-error test-only stub of the binding recorderService.ts normally exposes via Playwright's exposeBinding
      window.__aasRecordEvent = (action: unknown) => events.push(action);

      div.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      vi.advanceTimersByTime(1000);

      expect(events).toEqual([{ kind: "hover", locator: expect.objectContaining({ strategy: "css" }) }]);
    });

    it("does not treat a full-viewport wrapper (e.g. a page/app root container) as a hover target — only bounded, widget-sized elements", () => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
      const root = document.createElement("div");
      root.id = "app-root";
      // jsdom doesn't do real layout, so getBoundingClientRect() must be
      // stubbed to actually report a viewport-covering size for this case.
      root.getBoundingClientRect = () => ({ width: 1280, height: 800, top: 0, left: 0, right: 1280, bottom: 800, x: 0, y: 0, toJSON() {} });
      document.body.appendChild(root);

      const events: unknown[] = [];
      // @ts-expect-error test-only stub of the binding recorderService.ts normally exposes via Playwright's exposeBinding
      window.__aasRecordEvent = (action: unknown) => events.push(action);

      root.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      vi.advanceTimersByTime(1000);

      expect(events).toEqual([]);
    });

    it("regression: a hover immediately followed by a click on the SAME element is suppressed — not recorded as a separate hover step — since it's almost always just the mouse passing over the element on its way to being clicked, not a deliberate hover-to-reveal action", () => {
      const div = document.createElement("div");
      div.className = "card";
      div.style.width = "100px";
      div.style.height = "40px";
      document.body.appendChild(div);

      const events: { kind: string }[] = [];
      // @ts-expect-error test-only stub of the binding recorderService.ts normally exposes via Playwright's exposeBinding
      window.__aasRecordEvent = (action: { kind: string }) => events.push(action);

      div.setAttribute("role", "button"); // isClickTarget()-eligible, so the click handler processes it
      div.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      vi.advanceTimersByTime(500); // past HOVER_DWELL_MS — flashHighlight fires, but emission is still pending
      div.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      vi.advanceTimersByTime(500); // past HOVER_EMIT_BUFFER_MS too — the hover would have fired by now if not suppressed

      expect(events.map((e) => e.kind)).toEqual(["click"]);
    });

    it("regression: a click that lands BEFORE the 500ms dwell even completes (the common case — Playwright's own .click() and most real users act well under 500ms after the pointer arrives) still fully suppresses the hover, rather than leaving the pre-dwell timer to fire on its own afterward and record a stray hover for an interaction that already resolved as a click", () => {
      // Caught live: recording .click('#locName') captured a spurious
      // self.location_name.hover() in the generated code, immediately
      // followed by the real fill — the pre-dwell timer wasn't being
      // cancelled by the click at all, only the (later, not-yet-reached)
      // post-dwell pending emission was.
      const div = document.createElement("div");
      div.setAttribute("role", "button");
      document.body.appendChild(div);

      const events: { kind: string }[] = [];
      // @ts-expect-error test-only stub of the binding recorderService.ts normally exposes via Playwright's exposeBinding
      window.__aasRecordEvent = (action: { kind: string }) => events.push(action);

      div.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      vi.advanceTimersByTime(100); // well before HOVER_DWELL_MS (500ms) — no hover candidate committed yet
      div.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      vi.advanceTimersByTime(2000); // past dwell + emit buffer many times over

      expect(events.map((e) => e.kind)).toEqual(["click"]);
    });

    it("regression: clicking into a plain text field to focus it (before typing/filling) also suppresses a pending hover on that field — a text input is deliberately never itself recorded as a 'click' step (isClickTarget excludes it), so the click handler's own suppression call never ran for it, leaving its dwell timer free to fire later and record a stray hover immediately before the real fill", () => {
      // Caught live: recording page.click('#locName') then using the
      // recorder toolbar's Insert Random Value produced HOVER "Location
      // Name" immediately followed by FILL "Location Name" in the captured
      // steps — an interaction on the field that was never meant to record
      // anything by itself still left its pending hover state armed.
      const input = document.createElement("input");
      input.type = "text";
      document.body.appendChild(input);

      const events: { kind: string }[] = [];
      // @ts-expect-error test-only stub of the binding recorderService.ts normally exposes via Playwright's exposeBinding
      window.__aasRecordEvent = (action: { kind: string }) => events.push(action);

      input.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      vi.advanceTimersByTime(100); // well before HOVER_DWELL_MS
      input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      input.focus();
      vi.advanceTimersByTime(2000); // past dwell + emit buffer many times over — no fill/change dispatched, just the focus-click

      expect(events).toEqual([]);
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
      vi.advanceTimersByTime(1000); // past HOVER_DWELL_MS (500ms) + HOVER_EMIT_BUFFER_MS (450ms)

      expect(document.querySelectorAll("div > table > tbody > tr:nth-of-type(2)")).toHaveLength(3); // sanity: the naive 4-level path really is ambiguous here

      expect(events).toHaveLength(1);
      const locator = (events[0] as { kind: string; locator: { strategy: string; value: string } }).locator;
      expect(locator.strategy).toBe("css");
      expect(document.querySelectorAll(locator.value)).toHaveLength(1);
      expect(document.querySelectorAll(locator.value)[0]).toBe(targetRow);
    });
  });

  describe("__aasInsertRandomValue (recorder toolbar's 'Insert Random Value')", () => {
    afterEach(() => {
      document.body.innerHTML = "";
    });

    function install() {
      type InsertRandomValueFn = () => { ok: boolean; reason?: string };
      return (window as unknown as { __aasInsertRandomValue: InsertRandomValueFn }).__aasInsertRandomValue;
    }

    it("fails clearly when nothing is focused", () => {
      const input = document.createElement("input");
      document.body.appendChild(input);
      input.blur();
      const result = install()();
      expect(result.ok).toBe(false);
    });

    it("fails clearly when the focused element isn't a fillable text field (e.g. a checkbox)", () => {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      document.body.appendChild(checkbox);
      checkbox.focus();
      const result = install()();
      expect(result.ok).toBe(false);
    });

    it("fills the focused text field with a garbage-looking value and records it as a random (not literal) fill step, without double-recording via the change listener", () => {
      const input = document.createElement("input");
      input.type = "text";
      document.body.appendChild(input);
      input.focus();

      const events: { kind: string; value?: string; isRandom?: boolean }[] = [];
      // @ts-expect-error test-only stub of the binding recorderService.ts normally exposes via Playwright's exposeBinding
      window.__aasRecordEvent = (action: { kind: string; value?: string; isRandom?: boolean }) => events.push(action);

      const result = install()();

      expect(result.ok).toBe(true);
      expect(input.value).toMatch(/^[a-z]{6,10}\d{8}$/);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe("fill");
      expect(events[0].isRandom).toBe(true);
      expect(events[0].value).toBe(input.value);
    });
  });
});
