import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { loadProjectConfig } from "./config.js";

const SECRET_FILE = "config.secret";

function resolveSecretPath(cwd: string): string {
  const loaded = loadProjectConfig({ cwd });
  if (loaded.source) return join(dirname(loaded.source), SECRET_FILE);
  return join(resolve(cwd), ".relayos", SECRET_FILE);
}

export function getProjectConfigSecret(cwd: string): string | null {
  const envSecret = process.env.RELAYOS_CONFIG_SECRET?.trim();
  if (envSecret && envSecret.length > 0) return envSecret;
  const path = resolveSecretPath(cwd);
  if (!existsSync(path)) return null;
  const fileSecret = readFileSync(path, "utf8").trim();
  return fileSecret.length > 0 ? fileSecret : null;
}

export function ensureProjectConfigSecret(cwd: string): string {
  const existing = getProjectConfigSecret(cwd);
  if (existing) return existing;
  const generated = randomBytes(32).toString("base64url");
  const path = resolveSecretPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${generated}\n`, { encoding: "utf8", mode: 0o600 });
  return generated;
}
