import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { encryptWithKey, decryptWithKey } from "../../electron/services/crypto/aesGcm";

describe("aesGcm", () => {
  it("round-trips a plaintext value", () => {
    const key = crypto.randomBytes(32);
    const encrypted = encryptWithKey("super-secret-password", key);
    const decrypted = decryptWithKey(encrypted, key);
    expect(decrypted).toBe("super-secret-password");
  });

  it("produces a different ciphertext and IV each time (random IV)", () => {
    const key = crypto.randomBytes(32);
    const a = encryptWithKey("same-value", key);
    const b = encryptWithKey("same-value", key);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("fails to decrypt with the wrong key (tamper/auth-tag check)", () => {
    const key = crypto.randomBytes(32);
    const wrongKey = crypto.randomBytes(32);
    const encrypted = encryptWithKey("value", key);
    expect(() => decryptWithKey(encrypted, wrongKey)).toThrow();
  });

  it("fails to decrypt if the ciphertext is tampered with", () => {
    const key = crypto.randomBytes(32);
    const encrypted = encryptWithKey("value", key);
    encrypted.ciphertext[0] ^= 0xff;
    expect(() => decryptWithKey(encrypted, key)).toThrow();
  });
});
