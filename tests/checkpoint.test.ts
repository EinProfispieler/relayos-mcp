import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  CheckpointResolutionError,
  createCheckpoint,
  listCheckpoints,
  readCheckpoint,
  resolveCheckpoint,
} from "../src/checkpoint.js";
import { tempLayout } from "./_helpers.js";

const exec = promisify(execFile);

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

async function tempGitRepo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "relayos-checkpoint-repo-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  await exec("git", ["init", "--quiet", "--initial-branch=main"], { cwd: dir });
  await exec("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await exec("git", ["config", "user.name", "Test"], { cwd: dir });
  await exec("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  writeFileSync(join(dir, "tracked.txt"), "hello\n");
  await exec("git", ["add", "tracked.txt"], { cwd: dir });
  await exec("git", ["commit", "--quiet", "-m", "init"], { cwd: dir });
  return dir;
}

async function dirtyTempGitRepo(): Promise<string> {
  const dir = await tempGitRepo();
  writeFileSync(join(dir, "tracked.txt"), "hello world\n"); // modify tracked
  writeFileSync(join(dir, "new.txt"), "fresh content\n");   // untracked
  return dir;
}

async function tempNonGitDir(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "relayos-checkpoint-nongit-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe("createCheckpoint", () => {
  it("captures HEAD, branch, status, diff, and untracked from a dirty repo", async () => {
    const repo = await dirtyTempGitRepo();
    const temp = await tempLayout();
    cleanups.push(temp.cleanup);

    const checkpoint = await createCheckpoint(temp.layout, { cwd: repo });

    expect(checkpoint.id).toMatch(/^c_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(checkpoint.git.is_repo).toBe(true);
    expect(checkpoint.git.branch).toBe("main");
    expect(checkpoint.git.head).toMatch(/^[0-9a-f]{40}$/);
    expect(checkpoint.git.dirty).toBe(true);
    expect(checkpoint.counts.status_lines).toBeGreaterThan(0);
    expect(checkpoint.counts.untracked_lines).toBe(1);
    expect(checkpoint.counts.diff_bytes).toBeGreaterThan(0);
    expect(checkpoint.counts.diff_truncated).toBe(false);
    expect(checkpoint.message).toBeNull();

    const status = await readFile(checkpoint.files.status_path, "utf8");
    expect(status).toContain("tracked.txt");
    const diff = await readFile(checkpoint.files.diff_path, "utf8");
    expect(diff).toContain("hello world");
    const untracked = await readFile(checkpoint.files.untracked_path, "utf8");
    expect(untracked.trim().split("\n")).toEqual(["new.txt"]);
  });

  it("records clean repo state with empty diff and dirty=false", async () => {
    const repo = await tempGitRepo();
    const temp = await tempLayout();
    cleanups.push(temp.cleanup);

    const checkpoint = await createCheckpoint(temp.layout, { cwd: repo });

    expect(checkpoint.git.dirty).toBe(false);
    expect(checkpoint.counts.diff_bytes).toBe(0);
    expect(checkpoint.counts.untracked_lines).toBe(0);
    expect(checkpoint.counts.status_lines).toBe(0);
  });

  it("records a checkpoint even when cwd is not a git repo", async () => {
    const dir = await tempNonGitDir();
    const temp = await tempLayout();
    cleanups.push(temp.cleanup);

    const checkpoint = await createCheckpoint(temp.layout, { cwd: dir });

    expect(checkpoint.git.is_repo).toBe(false);
    expect(checkpoint.git.head).toBeNull();
    expect(checkpoint.git.branch).toBeNull();
    expect(checkpoint.git.dirty).toBe(false);
    expect(checkpoint.counts.status_lines).toBe(0);
    expect(checkpoint.counts.diff_bytes).toBe(0);
    expect(checkpoint.counts.untracked_lines).toBe(0);

    const status = await readFile(checkpoint.files.status_path, "utf8");
    expect(status).toBe("");
    const diff = await readFile(checkpoint.files.diff_path, "utf8");
    expect(diff).toBe("");
    const untracked = await readFile(checkpoint.files.untracked_path, "utf8");
    expect(untracked).toBe("");
  });

  it("persists message when provided", async () => {
    const repo = await tempGitRepo();
    const temp = await tempLayout();
    cleanups.push(temp.cleanup);

    const checkpoint = await createCheckpoint(temp.layout, {
      cwd: repo,
      message: "pre-codex review patch",
    });

    expect(checkpoint.message).toBe("pre-codex review patch");
  });
});

describe("readCheckpoint", () => {
  it("round-trips a created checkpoint", async () => {
    const repo = await dirtyTempGitRepo();
    const temp = await tempLayout();
    cleanups.push(temp.cleanup);

    const created = await createCheckpoint(temp.layout, { cwd: repo });
    const loaded = await readCheckpoint(temp.layout, created.id);

    expect(loaded).toEqual(created);
  });

  it("returns null for unknown ids", async () => {
    const temp = await tempLayout();
    cleanups.push(temp.cleanup);

    const loaded = await readCheckpoint(temp.layout, "c_DOES_NOT_EXIST");
    expect(loaded).toBeNull();
  });
});

describe("listCheckpoints", () => {
  it("returns checkpoints newest-first", async () => {
    const repo = await tempGitRepo();
    const temp = await tempLayout();
    cleanups.push(temp.cleanup);

    const a = await createCheckpoint(temp.layout, { cwd: repo });
    await new Promise((r) => setTimeout(r, 5));
    const b = await createCheckpoint(temp.layout, { cwd: repo });

    const items = await listCheckpoints(temp.layout);
    expect(items.map((c) => c.id)).toEqual([b.id, a.id]);
  });

  it("returns [] when no checkpoints exist", async () => {
    const temp = await tempLayout();
    cleanups.push(temp.cleanup);
    const items = await listCheckpoints(temp.layout);
    expect(items).toEqual([]);
  });
});

describe("resolveCheckpoint", () => {
  it("resolves latest when no selector is given", async () => {
    const repo = await tempGitRepo();
    const temp = await tempLayout();
    cleanups.push(temp.cleanup);

    const a = await createCheckpoint(temp.layout, { cwd: repo });
    await new Promise((r) => setTimeout(r, 5));
    const b = await createCheckpoint(temp.layout, { cwd: repo });

    const resolved = await resolveCheckpoint(temp.layout);
    expect(resolved.id).toBe(b.id);
    expect(a.id).not.toBe(b.id);
  });

  it("resolves by exact id", async () => {
    const repo = await tempGitRepo();
    const temp = await tempLayout();
    cleanups.push(temp.cleanup);

    const created = await createCheckpoint(temp.layout, { cwd: repo });
    const resolved = await resolveCheckpoint(temp.layout, created.id);
    expect(resolved.id).toBe(created.id);
  });

  it("resolves by N (1-based, newest=1)", async () => {
    const repo = await tempGitRepo();
    const temp = await tempLayout();
    cleanups.push(temp.cleanup);

    const a = await createCheckpoint(temp.layout, { cwd: repo });
    await new Promise((r) => setTimeout(r, 5));
    const b = await createCheckpoint(temp.layout, { cwd: repo });

    expect((await resolveCheckpoint(temp.layout, "1")).id).toBe(b.id);
    expect((await resolveCheckpoint(temp.layout, "2")).id).toBe(a.id);
  });

  it("throws no_checkpoints when storage is empty", async () => {
    const temp = await tempLayout();
    cleanups.push(temp.cleanup);

    await expect(resolveCheckpoint(temp.layout)).rejects.toBeInstanceOf(
      CheckpointResolutionError,
    );
  });

  it("throws unknown_id when id is missing", async () => {
    const temp = await tempLayout();
    cleanups.push(temp.cleanup);

    await expect(
      resolveCheckpoint(temp.layout, "c_DOES_NOT_EXIST"),
    ).rejects.toMatchObject({
      name: "CheckpointResolutionError",
      code: "unknown_id",
    });
  });

  it("throws out_of_range when N exceeds the list", async () => {
    const repo = await tempGitRepo();
    const temp = await tempLayout();
    cleanups.push(temp.cleanup);
    await createCheckpoint(temp.layout, { cwd: repo });

    await expect(resolveCheckpoint(temp.layout, "5")).rejects.toMatchObject({
      name: "CheckpointResolutionError",
      code: "out_of_range",
    });
  });
});
