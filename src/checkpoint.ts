import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import {
  gitBranch,
  gitDiff,
  gitHead,
  gitListUntracked,
  gitStatusShort,
  isGitRepo,
} from "./git.js";
import { newCheckpointId } from "./id.js";
import {
  checkpointDiffPath,
  checkpointMetaPath,
  checkpointStatusPath,
  checkpointUntrackedPath,
  type StorageLayout,
} from "./storage.js";

export interface CheckpointGit {
  is_repo: boolean;
  head: string | null;
  branch: string | null;
  dirty: boolean;
}

export interface CheckpointFiles {
  status_path: string;
  diff_path: string;
  untracked_path: string;
}

export interface CheckpointCounts {
  status_lines: number;
  diff_bytes: number;
  untracked_lines: number;
  diff_truncated: boolean;
}

export interface Checkpoint {
  id: string;
  created_at: string;
  cwd: string;
  git: CheckpointGit;
  files: CheckpointFiles;
  counts: CheckpointCounts;
  message: string | null;
}

export interface CheckpointSummary {
  id: string;
  created_at: string;
  cwd: string;
  branch: string | null;
  head: string | null;
  dirty: boolean;
  is_repo: boolean;
  message: string | null;
}

export type CheckpointResolutionErrorCode =
  | "unknown_id"
  | "out_of_range"
  | "no_checkpoints";

export class CheckpointResolutionError extends Error {
  constructor(
    public readonly code: CheckpointResolutionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CheckpointResolutionError";
  }
}

export interface CreateCheckpointOptions {
  cwd?: string;
  message?: string | null;
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (trimmed.length === 0) return 0;
  return trimmed.split("\n").length;
}

export async function createCheckpoint(
  layout: StorageLayout,
  opts: CreateCheckpointOptions = {},
): Promise<Checkpoint> {
  const cwd = opts.cwd ?? process.cwd();
  const id = newCheckpointId();
  const createdAt = new Date().toISOString();

  const repo = await isGitRepo(cwd);
  const head = repo ? await gitHead(cwd) : null;
  const branch = repo ? await gitBranch(cwd) : null;
  const statusText = repo ? await gitStatusShort(cwd) : "";
  const diffResult = repo ? await gitDiff(cwd) : { text: "", truncated: false };
  const untracked = repo ? await gitListUntracked(cwd) : [];
  const untrackedText =
    untracked.length === 0 ? "" : `${untracked.join("\n")}\n`;
  const dirty = statusText.trim().length > 0 || untracked.length > 0;

  const statusPath = checkpointStatusPath(layout, id);
  const diffPath = checkpointDiffPath(layout, id);
  const untrackedPath = checkpointUntrackedPath(layout, id);

  await writeFile(statusPath, statusText, "utf8");
  await writeFile(diffPath, diffResult.text, "utf8");
  await writeFile(untrackedPath, untrackedText, "utf8");

  const checkpoint: Checkpoint = {
    id,
    created_at: createdAt,
    cwd,
    git: { is_repo: repo, head, branch, dirty },
    files: {
      status_path: statusPath,
      diff_path: diffPath,
      untracked_path: untrackedPath,
    },
    counts: {
      status_lines: countLines(statusText),
      diff_bytes: Buffer.byteLength(diffResult.text, "utf8"),
      untracked_lines: untracked.length,
      diff_truncated: diffResult.truncated,
    },
    message: opts.message ?? null,
  };

  await writeFile(
    checkpointMetaPath(layout, id),
    `${JSON.stringify(checkpoint, null, 2)}\n`,
    "utf8",
  );

  return checkpoint;
}

export async function readCheckpoint(
  layout: StorageLayout,
  id: string,
): Promise<Checkpoint | null> {
  const path = checkpointMetaPath(layout, id);
  if (!existsSync(path)) return null;
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as Checkpoint;
}

export async function listCheckpoints(
  layout: StorageLayout,
): Promise<Checkpoint[]> {
  if (!existsSync(layout.checkpointsDir)) return [];
  const entries = await readdir(layout.checkpointsDir);
  const items: Checkpoint[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await readFile(`${layout.checkpointsDir}/${name}`, "utf8");
      items.push(JSON.parse(raw) as Checkpoint);
    } catch {
      // skip unparseable entries; resilience over strictness for `list`
    }
  }
  items.sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
    if (a.id === b.id) return 0;
    return a.id < b.id ? 1 : -1;
  });
  return items;
}

export function summarizeCheckpoint(c: Checkpoint): CheckpointSummary {
  return {
    id: c.id,
    created_at: c.created_at,
    cwd: c.cwd,
    branch: c.git.branch,
    head: c.git.head,
    dirty: c.git.dirty,
    is_repo: c.git.is_repo,
    message: c.message,
  };
}

export async function resolveCheckpoint(
  layout: StorageLayout,
  selector?: string,
): Promise<Checkpoint> {
  const trimmed = selector?.trim();

  if (trimmed && trimmed.startsWith("c_")) {
    const direct = await readCheckpoint(layout, trimmed);
    if (!direct) {
      throw new CheckpointResolutionError(
        "unknown_id",
        `checkpoint ${trimmed} was not found`,
      );
    }
    return direct;
  }

  const all = await listCheckpoints(layout);

  if (!trimmed || trimmed === "latest") {
    const latest = all[0];
    if (!latest) {
      throw new CheckpointResolutionError(
        "no_checkpoints",
        "no checkpoints found",
      );
    }
    return latest;
  }

  if (/^\d+$/.test(trimmed)) {
    const index = Number(trimmed) - 1;
    if (index < 0 || index >= all.length) {
      throw new CheckpointResolutionError(
        "out_of_range",
        `checkpoint selection ${trimmed} is out of range; ${all.length} checkpoint(s) available`,
      );
    }
    return all[index]!;
  }

  throw new CheckpointResolutionError(
    "unknown_id",
    `checkpoint ${trimmed} was not found`,
  );
}
