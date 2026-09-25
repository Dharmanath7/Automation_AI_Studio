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
const ADD_RANDOM_RE = /^add\s+(?:an?\s+)?random\s*(?:value|text|data|string)?\s+(?:in|into|to|for)\s+(.+)$/i;
const DOUBLE_CLICK_RE = /^double[\s-]?click\s*(?:on\s+)?(.+)$/i;
const CLICK_RE = /^(?:click|press|tap)\s*(?:on\s+)?(.+)$/i;
const HOVER_RE = /^hover\s*(?:on|over)?\s+(.+)$/i;
const UNCHECK_RE = /^uncheck\s+(.+)$/i;
const CHECK_RE = /^(?:check|tick)\s+(.+)$/i;
const FILL_WITH_RE = /^(?:fill|set)\s+(.+?)\s+(?:with|to)\s+(.+)$/i;
const ENTER_INTO_RE = /^(?:enter|type)\s+(.+?)\s+(?:in|into)\s+(.+)$/i;
const SELECT_RE = /^(?:select|choose)\s+(.+?)\s+(?:from|in)\s+(.+)$/i;
const VERIFY_VISIBLE_RE = /^(?:verify|assert|check)\s+(?:that\s+)?(.+?)\s+(?:is|are)\s+(?:visible|shown|displayed)$/i;

function makeStep(type: StepType, extra: Partial<TestStep> = {}): TestStep {
  return { id: uuidv4(), type, enabled: true, ...extra };
}

function randomValue(): TestValue {
  return { kind: "random", generator: "randomString", seedOnce: false };
}

function stripQuotes(s: string): string {
  const trimmed = s.trim();
  const m = trimmed.match(/^["'](.*)["']$/);
  return m ? m[1] : trimmed;
}

function isUrlLike(s: string): boolean {
  return /^https?:\/\//i.test(s) || /^www\./i.test(s) || /\.[a-z]{2,}(\/|$)/i.test(s);
}

function normalizeUrl(s: string): string {
  const trimmed = stripQuotes(s);
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

/**
 * Guesses a locator from a target phrase like "the Login button" or
 * "Username field" — an explicit role word at the end (button/link/
 * checkbox/dropdown/field/...) becomes a role-based locator with that word
 * stripped from the name; otherwise falls back to matching by visible text,
 * which reasonably covers buttons/links named directly ("Click Submit").
 */
function inferTarget(rawPhrase: string): StepTarget {
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

  return { preferred: { strategy: "text", value: phrase, quality: "fragile" }, alternatives: [] };
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

  // Random-value fills are checked before the generic fill/enter patterns
  // so "Fill Health Plan with a random value" is recognized as a random
  // fill, not a literal fill whose value happens to be the words "a random
  // value".
  if ((m = line.match(ADD_RANDOM_RE))) {
    return { step: makeStep("fill", { target: inferTarget(m[1]), value: randomValue() }) };
  }
  if (RANDOM_VALUE_WORD_RE.test(line)) {
    const targetPhrase = extractTargetForRandomValue(line);
    if (targetPhrase) return { step: makeStep("fill", { target: inferTarget(targetPhrase), value: randomValue() }) };
  }

  if ((m = line.match(FILL_WITH_RE))) {
    return { step: makeStep("fill", { target: inferTarget(m[1]), value: { kind: "literal", value: stripQuotes(m[2]) } }) };
  }
  if ((m = line.match(ENTER_INTO_RE))) {
    return { step: makeStep("fill", { target: inferTarget(m[2]), value: { kind: "literal", value: stripQuotes(m[1]) } }) };
  }
  if ((m = line.match(SELECT_RE))) {
    return { step: makeStep("select", { target: inferTarget(m[2]), value: { kind: "literal", value: stripQuotes(m[1]) } }) };
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
