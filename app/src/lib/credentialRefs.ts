import type { TestStep } from "@shared/testModel";

export interface CredentialRef {
  key: string; // "profileKey.field", used for React keys / de-dupe
  profileKey: string;
  field: string;
}

/** Every `credentials.<profile>.<field>` variable a Test Model's steps reference. */
export function collectCredentialRefs(steps: TestStep[]): CredentialRef[] {
  const refs = new Map<string, CredentialRef>();
  function consider(path: string | undefined) {
    if (!path || !path.startsWith("credentials.")) return;
    const parts = path.split(".");
    if (parts.length < 3) return;
    const profileKey = parts[1];
    const field = parts.slice(2).join(".");
    const key = `${profileKey}.${field}`;
    if (!refs.has(key)) refs.set(key, { key, profileKey, field });
  }
  for (const step of steps) {
    if (step.value?.kind === "variable") consider(step.value.path);
    if (step.assertion?.expected?.kind === "variable") consider(step.assertion.expected.path);
  }
  return Array.from(refs.values());
}

const FIELD_LABELS: Record<string, string> = {
  password: "Password",
  username: "Username",
  email: "Email",
  token: "Token",
  apikey: "API Key",
};

/** A plain, human label for a credential field — no "vault"/"profile" jargon. */
export function labelForField(field: string): string {
  const normalized = field.toLowerCase().replace(/[^a-z]/g, "");
  if (FIELD_LABELS[normalized]) return FIELD_LABELS[normalized];
  return field
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function isSecretField(field: string): boolean {
  return /password|secret|token|apikey|api[_-]?key/i.test(field);
}
