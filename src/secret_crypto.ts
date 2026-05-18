import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const PREFIX = "enc:v1";

function deriveKey(secret: string): Buffer {
  return scryptSync(secret, "relayos-config-salt-v1", 32);
}

export function encryptConfigSecret(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const key = deriveKey(secret);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptConfigSecret(encoded: string, secret: string): string {
  const parts = encoded.split(":");
  if (parts.length !== 5 || `${parts[0]}:${parts[1]}` !== PREFIX) {
    throw new Error("invalid encrypted secret format");
  }
  const iv = Buffer.from(parts[2] ?? "", "base64");
  const tag = Buffer.from(parts[3] ?? "", "base64");
  const ciphertext = Buffer.from(parts[4] ?? "", "base64");
  const key = deriveKey(secret);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString("utf8");
}

