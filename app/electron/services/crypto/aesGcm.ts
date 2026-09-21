import crypto from "node:crypto";

export interface EncryptedValue {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

/** Pure AES-256-GCM helpers, independent of Electron so they can be unit-tested directly. */
export function encryptWithKey(plaintext: string, key: Buffer): EncryptedValue {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag };
}

export function decryptWithKey(value: EncryptedValue, key: Buffer): string {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, value.iv);
  decipher.setAuthTag(value.authTag);
  const plaintext = Buffer.concat([decipher.update(value.ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
