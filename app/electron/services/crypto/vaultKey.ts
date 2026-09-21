import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";

const KEY_FILE_NAME = "vault.key";

function keyFilePath(): string {
  return path.join(app.getPath("userData"), KEY_FILE_NAME);
}

let cachedDek: Buffer | null = null;

/**
 * Loads (or creates on first run) the credential-vault data-encryption key (DEK).
 * The DEK never touches disk in the clear — it is wrapped with Electron's
 * safeStorage (OS credential store / DPAPI on Windows) before being written.
 * See docs/SECURITY.md §3.
 */
export function getVaultKey(): Buffer {
  if (cachedDek) return cachedDek;

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "OS secure storage (safeStorage) is unavailable on this machine. The credential vault cannot store or read secrets until it is."
    );
  }

  const file = keyFilePath();
  if (fs.existsSync(file)) {
    const wrapped = fs.readFileSync(file);
    const base64 = safeStorage.decryptString(wrapped);
    cachedDek = Buffer.from(base64, "base64");
    return cachedDek;
  }

  const dek = crypto.randomBytes(32);
  const wrapped = safeStorage.encryptString(dek.toString("base64"));
  fs.writeFileSync(file, wrapped, { mode: 0o600 });
  cachedDek = dek;
  return cachedDek;
}

export function resetVaultKeyCacheForTesting(): void {
  cachedDek = null;
}
