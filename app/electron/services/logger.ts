import path from "node:path";
import { app } from "electron";
import pino from "pino";

export type LogArea =
  | "auth" | "db" | "projects" | "recorder" | "browser" | "codegen"
  | "execution" | "reporting" | "git" | "runtime";

const REDACT_PATHS = [
  "password", "*.password", "secret", "*.secret", "token", "*.token",
  "apiKey", "*.apiKey", "credentials", "*.credentials", "AAS_CREDENTIALS_JSON",
];

const rootLogger = pino(
  { level: "info", redact: { paths: REDACT_PATHS, censor: "[REDACTED]" } },
  pino.destination({ dest: path.join(app.getPath("userData"), "logs", "studio.log"), mkdir: true, sync: false })
);

/** Structured logger for one functional area, per docs/SECURITY.md §7. Never pass raw credential objects — the redaction filter is defense-in-depth, not a substitute for not logging secrets. */
export function getLogger(area: LogArea) {
  return rootLogger.child({ area });
}
