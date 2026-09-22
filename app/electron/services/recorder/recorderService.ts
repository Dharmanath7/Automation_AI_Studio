import { chromium, type Browser, type BrowserContext } from "playwright";
import { v4 as uuidv4 } from "uuid";
import type { TestStep, LocatorCandidate, LocatorQuality, LocatorStrategy } from "../../shared/testModel";
import { RECORDER_INIT_SCRIPT } from "./pageScript";
import { getLogger } from "../logger";

const logger = getLogger("recorder");

export type RecorderEvent =
  | { type: "step"; step: TestStep }
  | { type: "closed" }
  | { type: "error"; message: string };

interface RecordedAction {
  kind: "click" | "dblclick" | "select" | "check" | "uncheck" | "fill";
  locator: LocatorCandidate;
  value?: string;
  isPassword?: boolean;
}

interface RecordingSession {
  id: string;
  browser: Browser;
  context: BrowserContext;
  steps: TestStep[];
  onEvent: (e: RecorderEvent) => void;
}

const sessions = new Map<string, RecordingSession>();

function isLocatorQuality(v: string): v is LocatorQuality {
  return ["excellent", "good", "fair", "fragile", "avoid"].includes(v);
}
function isLocatorStrategy(v: string): v is LocatorStrategy {
  return ["role", "testId", "label", "placeholder", "text", "css", "xpath"].includes(v);
}

function sanitizeLocator(raw: LocatorCandidate): LocatorCandidate {
  return {
    strategy: isLocatorStrategy(raw.strategy) ? raw.strategy : "css",
    value: String(raw.value ?? "").slice(0, 500),
    roleName: raw.roleName ? String(raw.roleName).slice(0, 200) : undefined,
    quality: isLocatorQuality(raw.quality) ? raw.quality : "fragile",
  };
}

function toTestStep(action: RecordedAction): TestStep | null {
  const id = uuidv4();
  const target = { preferred: sanitizeLocator(action.locator), alternatives: [] };

  switch (action.kind) {
    case "click":
      return { id, type: "click", target, enabled: true };
    case "dblclick":
      return { id, type: "doubleClick", target, enabled: true };
    case "check":
      return { id, type: "check", target, enabled: true };
    case "uncheck":
      return { id, type: "uncheck", target, enabled: true };
    case "select":
      return { id, type: "select", target, value: { kind: "literal", value: action.value ?? "" }, enabled: true };
    case "fill":
      // A password field's value is never captured — see pageScript.ts and
      // docs/SECURITY.md §4. It's stored as a Credential Vault reference
      // from the moment it's recorded, never as a literal in the buffer.
      if (action.isPassword) {
        return {
          id,
          type: "fill",
          target,
          value: { kind: "variable", path: "credentials.default.password" },
          enabled: true,
          note: "Password field — value not recorded; references the Credential Vault instead.",
        };
      }
      return { id, type: "fill", target, value: { kind: "literal", value: action.value ?? "" }, enabled: true };
    default:
      return null;
  }
}

export interface StartRecordingOptions {
  baseUrl: string;
  browser: "chrome" | "chromium";
  onEvent: (e: RecorderEvent) => void;
}

export async function startRecording(opts: StartRecordingOptions): Promise<string> {
  const debugPort = process.env.AAS_RECORDER_DEBUG_PORT;
  const launchOptions = {
    ...(opts.browser === "chrome" ? { channel: "chrome" as const } : {}),
    headless: false,
    ...(debugPort ? { args: [`--remote-debugging-port=${debugPort}`] } : {}),
  };

  let browser: Browser;
  try {
    browser = await chromium.launch(launchOptions);
  } catch (err) {
    throw new Error(
      opts.browser === "chromium"
        ? "Chromium isn't installed for the Studio's recorder. Use Chrome instead, or run 'npx playwright install chromium' in app/."
        : `Failed to launch Chrome: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const context = await browser.newContext();
  const sessionId = uuidv4();
  const steps: TestStep[] = [];
  const session: RecordingSession = { id: sessionId, browser, context, steps, onEvent: opts.onEvent };
  sessions.set(sessionId, session);

  function pushStep(step: TestStep) {
    steps.push(step);
    opts.onEvent({ type: "step", step });
  }

  await context.exposeBinding("__aasRecordEvent", async (_source, action: RecordedAction) => {
    const step = toTestStep(action);
    if (step) pushStep(step);
  });
  await context.addInitScript(RECORDER_INIT_SCRIPT);

  const page = await context.newPage();

  let lastUrl: string | null = null;
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    const url = frame.url();
    if (url === "about:blank" || url === lastUrl) return;
    lastUrl = url;
    pushStep({ id: uuidv4(), type: "navigate", value: { kind: "literal", value: url }, enabled: true });
  });

  browser.on("disconnected", () => {
    if (sessions.has(sessionId)) {
      sessions.delete(sessionId);
      opts.onEvent({ type: "closed" });
    }
  });

  logger.info({ sessionId, browser: opts.browser }, "recording started");

  try {
    await page.goto(opts.baseUrl, { waitUntil: "domcontentloaded" });
  } catch (err) {
    logger.warn({ sessionId, err: String(err) }, "initial navigation failed; recording continues");
  }

  // The goto above is captured as a literal-URL navigate step by the
  // framenavigated listener; replace it with {{base_url}} so the recorded
  // test never hardcodes the environment (docs/TEST_MODEL.md rule #2).
  if (steps.length > 0 && steps[0].type === "navigate") {
    steps[0].value = { kind: "variable", path: "base_url" };
  }

  return sessionId;
}

export async function stopRecording(sessionId: string): Promise<TestStep[]> {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("Recording session not found — it may have already been stopped or the browser window was closed.");
  sessions.delete(sessionId);
  const steps = session.steps;
  await session.browser.close().catch(() => {});
  logger.info({ sessionId, stepCount: steps.length }, "recording stopped");
  return steps;
}

export function isRecording(sessionId: string): boolean {
  return sessions.has(sessionId);
}
