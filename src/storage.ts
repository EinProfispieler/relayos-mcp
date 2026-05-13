import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";

export interface StorageLayout {
  root: string;
  auditPath: string;
  envelopesDir: string;
  checkpointsDir: string;
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
    checkpointsDir: join(root, "checkpoints"),
  };
}

export async function ensureStorage(layout: StorageLayout): Promise<void> {
  await mkdir(layout.envelopesDir, { recursive: true });
  await mkdir(layout.checkpointsDir, { recursive: true });
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

export function checkpointMetaPath(layout: StorageLayout, id: string): string {
  return join(layout.checkpointsDir, `${id}.json`);
}

export function checkpointDiffPath(layout: StorageLayout, id: string): string {
  return join(layout.checkpointsDir, `${id}.diff`);
}

export function checkpointStatusPath(layout: StorageLayout, id: string): string {
  return join(layout.checkpointsDir, `${id}.status`);
}

export function checkpointUntrackedPath(layout: StorageLayout, id: string): string {
  return join(layout.checkpointsDir, `${id}.untracked`);
}
