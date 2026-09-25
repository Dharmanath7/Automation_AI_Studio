import type { Browser, BrowserContext, Locator, Page } from "playwright";
import { v4 as uuidv4 } from "uuid";
import type { TestStep, StepTarget, LocatorCandidate, TestValue } from "../../shared/testModel";
import { generateRandomValue, generateBoundaryValue } from "../../shared/randomData";
import { launchBrowser, type RecorderBrowser } from "../recorder/recorderService";
import { getLogger } from "../logger";

const logger = getLogger("preview");

const ACTION_TIMEOUT_MS = 5000;

export type PreviewStepStatus = "running" | "passed" | "failed" | "skipped";

export type PreviewEvent =
  | { type: "stepStart"; stepId: string; index: number }
  | { type: "stepResult"; stepId: string; index: number; status: PreviewStepStatus; message?: string; matchedStrategy?: string }
  | { type: "finished" }
  | { type: "closed" };

interface PreviewSession {
  id: string;
  browser: Browser;
  context: BrowserContext;
  stopped: boolean;
}

const sessions = new Map<string, PreviewSession>();

export interface PreviewEnv {
  base_url: string;
  api_url?: string;
  [key: string]: string | undefined;
}

/** A step whose value references the Credential Vault gets an obviously-fake placeholder during preview — decrypting real credentials for a throwaway dry run isn't worth the added security surface, and the note on the result says so plainly rather than silently using a fake value. */
const CREDENTIAL_PLACEHOLDER = "(preview — Credential Vault value not used here)";

export function resolvePreviewValue(value: TestValue | undefined, env: PreviewEnv): { text: string; note?: string } {
  if (!value) return { text: "" };
  switch (value.kind) {
    case "literal":
      return { text: value.value };
    case "variable":
      if (value.path === "base_url") return { text: env.base_url };
      if (value.path.startsWith("credentials.")) return { text: CREDENTIAL_PLACEHOLDER, note: "used a placeholder instead of the real Credential Vault value" };
      return { text: env[value.path] ?? "" };
    case "random":
      return { text: generateRandomValue(value.generator, value.pattern) };
    case "boundary":
      return { text: generateBoundaryValue(value.boundary) };
    default:
      return { text: "" };
  }
}

export function buildLocator(page: Page, candidate: LocatorCandidate): Locator {
  switch (candidate.strategy) {
    case "role":
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- role names are stored as plain strings in the Test Model, not statically checked against Playwright's ARIA role union
      return page.getByRole(candidate.value as any, candidate.roleName ? { name: candidate.roleName } : undefined);
    case "testId":
      return page.getByTestId(candidate.value);
    case "label":
      return page.getByLabel(candidate.value);
    case "placeholder":
      return page.getByPlaceholder(candidate.value);
    case "text":
      return page.getByText(candidate.value);
    case "xpath":
      return page.locator(`xpath=${candidate.value}`);
    case "css":
    default:
      return page.locator(candidate.value);
  }
}

/**
 * Tries the target's preferred locator, then each alternative in order,
 * returning the first that resolves to at least one element on the live
 * page — the whole point of "Try It in a Browser": a guessed locator from
 * plain-English (or any other fragile-quality candidate) either works
 * against the real DOM or it doesn't, verified directly rather than
 * assumed.
 */
export async function resolveLocator(page: Page, target: StepTarget | undefined): Promise<{ locator: Locator; candidate: LocatorCandidate } | null> {
  if (!target) return null;
  const candidates = [target.preferred, ...target.alternatives];
  for (const candidate of candidates) {
    try {
      const locator = buildLocator(page, candidate);
      const count = await locator.count();
      if (count >= 1) return { locator: count > 1 ? locator.first() : locator, candidate };
    } catch {
      // Malformed candidate (e.g. invalid xpath/css) — try the next one.
    }
  }
  return null;
}

export function candidateLabel(candidate: LocatorCandidate): string {
  return candidate.roleName ? `${candidate.strategy}="${candidate.roleName}"` : `${candidate.strategy}="${candidate.value}"`;
}

export async function runStep(page: Page, step: TestStep, env: PreviewEnv): Promise<{ status: PreviewStepStatus; message?: string; matchedStrategy?: string }> {
  const timeout = ACTION_TIMEOUT_MS;
  try {
    switch (step.type) {
      case "navigate": {
        const { text } = resolvePreviewValue(step.value, env);
        await page.goto(text, { waitUntil: "domcontentloaded", timeout });
        return { status: "passed" };
      }
      case "goBack":
        await page.goBack({ timeout });
        return { status: "passed" };
      case "goForward":
        await page.goForward({ timeout });
        return { status: "passed" };
      case "refresh":
        await page.reload({ timeout });
        return { status: "passed" };
      case "pressKey": {
        const { text } = resolvePreviewValue(step.value, env);
        await page.keyboard.press(text);
        return { status: "passed" };
      }
      case "scroll":
        await page.mouse.wheel(0, 800);
        return { status: "passed" };
      case "click":
      case "doubleClick":
      case "hover":
      case "check":
      case "uncheck":
      case "fill":
      case "select":
      case "assert": {
        const resolved = await resolveLocator(page, step.target);
        if (!resolved) {
          return { status: "failed", message: "No element on the page matched this locator." };
        }
        const { locator, candidate } = resolved;
        const matchedStrategy = candidateLabel(candidate);
        if (step.type === "click") await locator.click({ timeout });
        else if (step.type === "doubleClick") await locator.dblclick({ timeout });
        else if (step.type === "hover") await locator.hover({ timeout });
        else if (step.type === "check") await locator.check({ timeout });
        else if (step.type === "uncheck") await locator.uncheck({ timeout });
        else if (step.type === "fill") {
          const { text, note } = resolvePreviewValue(step.value, env);
          await locator.fill(text, { timeout });
          if (note) return { status: "passed", matchedStrategy, message: note };
        } else if (step.type === "select") {
          const { text } = resolvePreviewValue(step.value, env);
          await locator.selectOption(text, { timeout });
        } else if (step.type === "assert") {
          if (step.assertion?.type !== "visible") {
            return { status: "skipped", message: `Assertion type "${step.assertion?.type ?? "unknown"}" isn't checked during preview.` };
          }
          const visible = await locator.isVisible().catch(() => false);
          if (!visible) return { status: "failed", message: "Element found but not visible." };
        }
        return { status: "passed", matchedStrategy };
      }
      default:
        return { status: "skipped", message: `"${step.type}" isn't executed during preview yet.` };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return { status: "failed", message: msg };
  }
}

export interface StartPreviewOptions {
  steps: TestStep[];
  env: PreviewEnv;
  browser: RecorderBrowser;
  onEvent: (e: PreviewEvent) => void;
}

/**
 * Launches a real, visible browser and walks through the given steps one
 * at a time, live — "Try It in a Browser" for the manual/plain-English
 * test builder, so a guessed locator or a freshly-typed instruction is
 * verified against the actual page instead of taken on faith. Runs
 * asynchronously in the background (returns the session id immediately);
 * per-step progress streams via onEvent. The browser is left open after
 * the last step so the person can look at the final state, until
 * stopPreview() closes it.
 */
export async function startPreview(opts: StartPreviewOptions): Promise<string> {
  const browser = await launchBrowser(opts.browser);
  const context = await browser.newContext({ viewport: null });
  const sessionId = uuidv4();
  const session: PreviewSession = { id: sessionId, browser, context, stopped: false };
  sessions.set(sessionId, session);

  browser.on("disconnected", () => {
    if (sessions.has(sessionId)) {
      sessions.delete(sessionId);
      opts.onEvent({ type: "closed" });
    }
  });

  const page = await context.newPage();

  // Runs in the background — startPreview() itself returns as soon as the
  // browser is up, not once every step has executed.
  void (async () => {
    for (let i = 0; i < opts.steps.length; i++) {
      if (session.stopped || !sessions.has(sessionId)) break;
      const step = opts.steps[i];
      if (!step.enabled) continue;
      opts.onEvent({ type: "stepStart", stepId: step.id, index: i });
      const result = await runStep(page, step, opts.env);
      if (!sessions.has(sessionId)) break; // stopped mid-step
      opts.onEvent({ type: "stepResult", stepId: step.id, index: i, ...result });
    }
    if (sessions.has(sessionId)) opts.onEvent({ type: "finished" });
  })().catch((err) => {
    logger.warn({ sessionId, err: String(err) }, "preview run failed unexpectedly");
  });

  logger.info({ sessionId, browser: opts.browser, stepCount: opts.steps.length }, "preview started");
  return sessionId;
}

export async function stopPreview(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.stopped = true;
  sessions.delete(sessionId);
  await session.browser.close().catch(() => {});
  logger.info({ sessionId }, "preview stopped");
}
