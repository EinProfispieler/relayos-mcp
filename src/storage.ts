import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";

export interface StorageLayout {
  root: string;
  auditPath: string;
  envelopesDir: string;
}

export function resolveStorageLayout(env: NodeJS.ProcessEnv = process.env): StorageLayout {
  const override = env.HANDOFF_DIR?.trim();
  const root = override && override.length > 0
    ? resolve(override)
    : join(homedir(), ".claude", "handoff");
  return {
    root,
    auditPath: join(root, "audit.jsonl"),
    envelopesDir: join(root, "envelopes"),
  };
}

export async function ensureStorage(layout: StorageLayout): Promise<void> {
  await mkdir(layout.envelopesDir, { recursive: true });
}

export function envelopePath(layout: StorageLayout, id: string): string {
  return join(layout.envelopesDir, `${id}.json`);
}

export function stdoutLogPath(layout: StorageLayout, id: string): string {
  return join(layout.envelopesDir, `${id}.stdout.log`);
}

export function stderrLogPath(layout: StorageLayout, id: string): string {
  return join(layout.envelopesDir, `${id}.stderr.log`);
}
