/**
 * Turns plain-English test instructions (one action per line — e.g. "Go to
 * https://example.com", "Click on Login button", "Fill Username with John",
 * "Add random value in Health Plan Name") into TestSteps for the manual test
 * builder. Pure text processing, no Node/Electron APIs, so this is safe to
 * import from both the renderer and the main process.
 *
 * This is deliberately a small, explicit set of rule-based patterns, not
 * general-purpose NLP — there's no model to call out to from inside this
 * offline desktop app. Locators inferred from a phrase alone (no live DOM
 * to check against, unlike the recorder) are marked "fair"/"fragile"
 * quality on purpose: they're a fast first draft meant to be reviewed and
 * adjusted in the step editor afterward, not treated as exact. Any line
 * that doesn't match a known pattern becomes a warning naming the line
 * number and text, rather than being silently dropped or guessed at.
 */
import { v4 as uuidv4 } from "uuid";
import type { TestStep, StepTarget, TestValue, LocatorStrategy, StepType } from "./testModel";

export interface ParseResult {
  steps: TestStep[];
  warnings: string[];
}

const RANDOM_VALUE_WORD_RE = /\brandom\s*(value|text|data|string)?\b/i;

const PRESS_KEY_RE = /^press\s+(enter|tab|escape|esc|backspace|delete)$/i;
const GO_BACK_RE = /^go\s*back$/i;
const GO_FORWARD_RE = /^go\s*forward$/i;
const REFRESH_RE = /^(?:refresh|reload)(?:\s+the\s+page)?$/i;
const NAVIGATE_RE = /^(?:go\s*to|navigate\s*to|open|visit)\s+(.+)$/i;
const WAIT_RE =
  /^wait\s+(?:till|until)\s+(?:the\s+)?(.+?)\s+(?:loads?|appears?|is\s+(?:visible|shown|displayed)|saves?|completes?|finishes?|updates?|renders?|opens?|closes?|disappears?)$/i;
const ADD_RANDOM_RE = /^add\s+(?:an?\s+)?random\s*(?:value|text|data|string)?\s+(?:in|into|to|for)\s+(.+)$/i;
// "Add a Random healthplan Name" — the field name follows "random" directly,
// with no in/into/to/for connector word at all.
const ADD_RANDOM_INLINE_RE = /^add\s+(?:an?\s+)?random\s+(.+)$/i;
// "Add the same Healthplan external code under EXTERNAL CODE field" — refers
// back to a previously generated value, which the Test Model has no way to
// represent (no "same as step N" value kind) — treated as its own random
// value with a note explaining the substitution, rather than silently
// guessing at an exact link that can't actually be made.
const SAME_VALUE_UNDER_FIELD_RE = /\bsame\b.*\bunder\s+(?:the\s+)?(.+?)\s+field\b/i;
const DOUBLE_CLICK_RE = /^double[\s-]?click\s*(?:on\s+)?(.+)$/i;
const CLICK_RE = /^(?:click|press|tap)\s*(?:on\s+)?(.+)$/i;
const HOVER_RE = /^hover\s*(?:on|over)?\s+(.+)$/i;
const UNCHECK_RE = /^uncheck\s+(.+)$/i;
const CHECK_RE = /^(?:check|tick)\s+(.+)$/i;
const FILL_WITH_RE = /^(?:fill|set)\s+(.+?)\s+(?:with|to)\s+(.+)$/i;
const ENTER_INTO_RE = /^(?:enter|type)\s+(.+?)\s+(?:in|into)\s+(.+)$/i;
// "Enter the username as X" — same idea as ENTER_INTO_RE but with "as"
// instead of "in"/"into", and the target/value order matching FILL_WITH_RE
// (target first).
const ENTER_AS_RE = /^enter\s+(?:the\s+)?(.+?)\s+as\s+(.+)$/i;
const SELECT_RE = /^(?:select|choose)\s+(.+?)\s+(?:from|in)\s+(.+)$/i;
const VERIFY_VISIBLE_RE = /^(?:verify|assert|check)\s+(?:that\s+)?(.+?)\s+(?:is|are)\s+(?:visible|shown|displayed)$/i;
// Last-resort fallback, checked only after every explicit-verb pattern above
// has failed to match: "Password as X" / "<Field> as X" with no leading verb
// at all — a common shorthand for "fill this field with this value".
const IMPLICIT_FILL_AS_RE = /^(.+?)\s+as\s+(.+)$/i;

function makeStep(type: StepType, extra: Partial<TestStep> = {}): TestStep {
  return { id: uuidv4(), type, enabled: true, ...extra };
}

function randomValue(): TestValue {
  return { kind: "random", generator: "randomString", seedOnce: false };
}

function stripQuotes(s: string): string {
  const trimmed = s.trim();
  const m = trimmed.match(/^["'“](.*)["'”]$/);
  return m ? m[1] : trimmed;
}

function isUrlLike(s: string): boolean {
  return /^https?:\/\//i.test(s) || /^www\./i.test(s) || /\.[a-z]{2,}(\/|$)/i.test(s);
}

function normalizeUrl(s: string): string {
  const trimmed = stripQuotes(s);
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // Anything isUrlLike() judged a domain (e.g. "google.com", not just the
  // "www."-prefixed case) needs an explicit protocol — Playwright's
  // page.goto() rejects a bare domain string outright ("Cannot navigate to
  // invalid URL") rather than assuming https, unlike a browser's address
  // bar. Caught live: "Go to google.com" failed this way even though
  // isUrlLike() correctly recognized it as a URL.
  return `https://${trimmed}`;
}

/**
 * Guesses a locator from a target phrase like "the Login button" or
 * "Username field" — an explicit role word at the end (button/link/
 * checkbox/dropdown/field/...) becomes a role-based locator with that word
 * stripped from the name; otherwise falls back to matching by visible text
 * for click-like actions (buttons/links are usually named by their visible
 * text) or by label for fill-like ones — get_by_text("Username") would
 * actually resolve to the <label> element itself (which can't be filled),
 * not the input it labels, whereas get_by_label() correctly finds the
 * associated input.
 */
function inferTarget(rawPhrase: string, kind: "fill" | "click" = "click"): StepTarget {
  const phrase = stripQuotes(rawPhrase).replace(/^(the|a|an)\s+/i, "").trim();

  const roleSuffixes: { re: RegExp; role: string }[] = [
    { re: /\s+button$/i, role: "button" },
    { re: /\s+link$/i, role: "link" },
    { re: /\s+checkbox$/i, role: "checkbox" },
    { re: /\s+radio(?:\s*button)?$/i, role: "radio" },
    { re: /\s+(?:dropdown|drop-down|select)$/i, role: "combobox" },
    { re: /\s+(?:field|input|box|textbox)$/i, role: "textbox" },
    { re: /\s+tab$/i, role: "tab" },
    { re: /\s+menu(?:\s*item)?$/i, role: "menuitem" },
  ];

  for (const { re, role } of roleSuffixes) {
    if (re.test(phrase)) {
      const roleName = phrase.replace(re, "").trim();
      const preferred = { strategy: "role" as LocatorStrategy, value: role, roleName: roleName || phrase, quality: "fair" as const };
      return { preferred, alternatives: [{ strategy: "text", value: phrase, quality: "fragile" }] };
    }
  }

  if (kind === "fill") {
    return {
      preferred: { strategy: "label", value: phrase, quality: "fair" },
      alternatives: [
        { strategy: "placeholder", value: phrase, quality: "fragile" },
        { strategy: "text", value: phrase, quality: "fragile" },
      ],
    };
  }
  return { preferred: { strategy: "text", value: phrase, quality: "fragile" }, alternatives: [] };
}

/**
 * A fill step whose target phrase mentions "password" uses the Credential
 * Vault instead of the literal value typed in the instructions — the same
 * rule the recorder itself follows (see pageScript.ts/recorderService.ts):
 * a real password should never end up as plain text in the Test Model,
 * even if it was only ever typed into this plain-English box locally. The
 * originally-typed value is discarded (not persisted anywhere) and a note
 * on the step explains the substitution so it isn't a silent surprise.
 */
function buildFillStep(targetPhrase: string, literalRaw: string): TestStep {
  const target = inferTarget(targetPhrase, "fill");
  if (/\bpassword\b/i.test(targetPhrase)) {
    return makeStep("fill", {
      target,
      value: { kind: "variable", path: "credentials.default.password" },
      note: "Password field — using the Credential Vault instead of the typed value, for security (see Environments & Credentials).",
    });
  }
  return makeStep("fill", { target, value: { kind: "literal", value: stripQuotes(literalRaw) } });
}

/**
 * A line that mentions "random value"/"random text"/etc. but doesn't match
 * the explicit "Add random value in X" phrasing — tries a few other common
 * ways of saying the same thing, e.g. "Fill Health Plan with a random
 * value", "Health Plan: random value", "Health Plan needs a random value".
 */
function extractTargetForRandomValue(line: string): string | null {
  let m = line.match(/^(?:fill|set|enter|type)\s+(.+?)\s+(?:with|to|as)\s+(?:an?\s+)?random\s*(?:value|text|data|string)?$/i);
  if (m) return m[1];
  m = line.match(/^(.+?)\s*[-:]\s*(?:an?\s+)?random\s*(?:value|text|data|string)?$/i);
  if (m) return m[1];
  m = line.match(/^(.+?)\s+(?:should\s+have|needs?|gets?|with)\s+(?:an?\s+)?random\s*(?:value|text|data|string)?$/i);
  if (m) return m[1];
  return null;
}

function parseLine(rawLine: string, lineNumber: number): { step?: TestStep; warning?: string } {
  const line = rawLine.trim().replace(/[.]+$/, "");
  if (!line) return {};

  let m: RegExpMatchArray | null;

  if (GO_BACK_RE.test(line)) return { step: makeStep("goBack") };
  if (GO_FORWARD_RE.test(line)) return { step: makeStep("goForward") };
  if (REFRESH_RE.test(line)) return { step: makeStep("refresh") };

  if ((m = line.match(PRESS_KEY_RE))) {
    const raw = m[1].toLowerCase();
    const key = raw === "esc" ? "Escape" : raw.charAt(0).toUpperCase() + raw.slice(1);
    return { step: makeStep("pressKey", { value: { kind: "literal", value: key } }) };
  }

  if ((m = line.match(NAVIGATE_RE))) {
    const dest = m[1].trim();
    const value: TestValue = isUrlLike(dest) ? { kind: "literal", value: normalizeUrl(dest) } : { kind: "variable", path: "base_url" };
    return { step: makeStep("navigate", { value }) };
  }

  // "Wait till X loads/saves/..." — this app already waits automatically
  // (Smart Waits) before every action, so there's no separate "wait" step
  // type to generate; the closest useful translation is a visibility
  // assertion on the named element, which both documents the expected state
  // at that point in the flow and gives Playwright's own auto-retrying
  // expect() something concrete to wait on.
  if ((m = line.match(WAIT_RE))) {
    return { step: makeStep("assert", { target: inferTarget(m[1]), assertion: { type: "visible" } }) };
  }

  // Random-value fills are checked before the generic fill/enter patterns
  // so "Fill Health Plan with a random value" is recognized as a random
  // fill, not a literal fill whose value happens to be the words "a random
  // value".
  if ((m = line.match(ADD_RANDOM_RE))) {
    return { step: makeStep("fill", { target: inferTarget(m[1], "fill"), value: randomValue() }) };
  }
  if ((m = line.match(ADD_RANDOM_INLINE_RE))) {
    return { step: makeStep("fill", { target: inferTarget(m[1], "fill"), value: randomValue() }) };
  }
  if ((m = line.match(SAME_VALUE_UNDER_FIELD_RE))) {
    return {
      step: makeStep("fill", {
        target: inferTarget(m[1], "fill"),
        value: randomValue(),
        note: 'Interpreted "the same ... value" as a new random value — the Test Model has no way to exactly reuse a previous step\'s generated value. If this field must match another step exactly, change its Value Source to Variable and reference that step\'s value by hand.',
      }),
    };
  }
  if (RANDOM_VALUE_WORD_RE.test(line)) {
    const targetPhrase = extractTargetForRandomValue(line);
    if (targetPhrase) return { step: makeStep("fill", { target: inferTarget(targetPhrase, "fill"), value: randomValue() }) };
  }

  if ((m = line.match(FILL_WITH_RE))) return { step: buildFillStep(m[1], m[2]) };
  if ((m = line.match(ENTER_INTO_RE))) return { step: buildFillStep(m[2], m[1]) };
  if ((m = line.match(ENTER_AS_RE))) return { step: buildFillStep(m[1], m[2]) };
  if ((m = line.match(SELECT_RE))) {
    return { step: makeStep("select", { target: inferTarget(m[2], "fill"), value: { kind: "literal", value: stripQuotes(m[1]) } }) };
  }
  if ((m = line.match(VERIFY_VISIBLE_RE))) {
    return { step: makeStep("assert", { target: inferTarget(m[1]), assertion: { type: "visible" } }) };
  }

  // Double-click before click — "double click X" would otherwise also
  // match the (deliberately broad) click pattern.
  if ((m = line.match(DOUBLE_CLICK_RE))) {
    return { step: makeStep("doubleClick", { target: inferTarget(m[1]) }) };
  }
  if ((m = line.match(HOVER_RE))) {
    return { step: makeStep("hover", { target: inferTarget(m[1]) }) };
  }
  if ((m = line.match(UNCHECK_RE))) {
    return { step: makeStep("uncheck", { target: inferTarget(m[1]) }) };
  }
  if ((m = line.match(CHECK_RE))) {
    return { step: makeStep("check", { target: inferTarget(m[1]) }) };
  }
  if ((m = line.match(CLICK_RE))) {
    return { step: makeStep("click", { target: inferTarget(m[1]) }) };
  }

  // Last resort: "<field> as <value>" with no leading verb at all — e.g.
  // "Password as Ubisoft@12". Checked only once nothing more specific above
  // has matched, since "X as Y" on its own is a much weaker signal than any
  // of the explicit-verb patterns.
  if ((m = line.match(IMPLICIT_FILL_AS_RE))) return { step: buildFillStep(m[1], m[2]) };

  return { warning: `Line ${lineNumber}: couldn't understand "${rawLine.trim()}" — add it manually with "+ Add step…" below.` };
}

export function parseInstructionsToSteps(text: string): ParseResult {
  const steps: TestStep[] = [];
  const warnings: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    if (!raw.trim()) return;
    const { step, warning } = parseLine(raw, i + 1);
    if (step) steps.push(step);
    if (warning) warnings.push(warning);
  });
  return { steps, warnings };
}
