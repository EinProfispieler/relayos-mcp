import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

const exec = promisify(execFile);

const cleanups: Array<() => void> = [];
let previousCwd: string | undefined;
let previousHandoffDir: string | undefined;

afterEach(() => {
  if (previousCwd) {
    process.chdir(previousCwd);
    previousCwd = undefined;
  }
  if (previousHandoffDir !== undefined) {
    if (previousHandoffDir) {
      process.env.HANDOFF_DIR = previousHandoffDir;
    } else {
      delete process.env.HANDOFF_DIR;
    }
    previousHandoffDir = undefined;
  }
  while (cleanups.length) cleanups.pop()!();
});

async function tempGitRepo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "relayos-cli-report-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  await exec("git", ["init", "--quiet", "--initial-branch=main"], { cwd: dir });
  await exec("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await exec("git", ["config", "user.name", "Test"], { cwd: dir });
  await exec("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "hello\n");
  await exec("git", ["add", "README.md"], { cwd: dir });
  await exec("git", ["commit", "--quiet", "-m", "init"], { cwd: dir });
  return dir;
}

function tempHandoffDir(): void {
  previousHandoffDir = process.env.HANDOFF_DIR;
  const dir = mkdtempSync(join(tmpdir(), "relayos-report-handoff-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  process.env.HANDOFF_DIR = dir;
}

function captureIO() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: { write: (chunk: string) => (stdout += chunk) },
      stderr: { write: (chunk: string) => (stderr += chunk) },
    },
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

function chdir(dir: string) {
  previousCwd = process.cwd();
  process.chdir(dir);
}

describe("relayos report", () => {
  it("prints all four sections and exits 0 for a clean git repo with empty storage", async () => {
    const repo = await tempGitRepo();
    tempHandoffDir();
    chdir(repo);
    const cap = captureIO();

    const code = await runCli(["report"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("RELAYOS REPORT");
    expect(cap.stdout).toContain("LATEST HANDOFF");
    expect(cap.stdout).toContain("LATEST CHECKPOINT");
    expect(cap.stdout).toContain("DIFF-RISK");
    expect(cap.stdout).toContain("GIT STATUS");
    expect(cap.stderr).toBe("");
  });

  it("shows no-data messages when storage is empty", async () => {
    const repo = await tempGitRepo();
    tempHandoffDir();
    chdir(repo);
    const cap = captureIO();

    await runCli(["report"], cap.io);

    expect(cap.stdout).toContain("no handoffs found");
    expect(cap.stdout).toContain("no checkpoints found");
  });

  it("shows git branch and a 7-char head for a committed repo", async () => {
    const repo = await tempGitRepo();
    tempHandoffDir();
    chdir(repo);
    const cap = captureIO();

    await runCli(["report"], cap.io);

    expect(cap.stdout).toMatch(/branch:\s+main/);
    expect(cap.stdout).toMatch(/head:\s+[0-9a-f]{7}/);
  });

  it("shows clean status when working tree has no changes", async () => {
    const repo = await tempGitRepo();
    tempHandoffDir();
    chdir(repo);
    const cap = captureIO();

    await runCli(["report"], cap.io);

    expect(cap.stdout).toContain("DECISION: ALLOW");
    expect(cap.stdout).toContain("(clean)");
  });

  it("shows not-a-git-repo note and exits 0 outside a git working tree", async () => {
    const nonRepo = mkdtempSync(join(tmpdir(), "relayos-report-nongit-"));
    cleanups.push(() => rmSync(nonRepo, { recursive: true, force: true }));
    tempHandoffDir();
    chdir(nonRepo);
    const cap = captureIO();

    const code = await runCli(["report"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("not inside a git working tree");
    expect(cap.stderr).toBe("");
  });

  it("shows DIFF-RISK BLOCK when an untracked .env file exists", async () => {
    const repo = await tempGitRepo();
    writeFileSync(join(repo, ".env"), "SECRET=abc\n");
    tempHandoffDir();
    chdir(repo);
    const cap = captureIO();

    await runCli(["report"], cap.io);

    expect(cap.stdout).toContain("DECISION: BLOCK");
    expect(cap.stdout).toContain("secret_config_path");
  });

  it("rejects unknown flags with usage on stderr and exits 1", async () => {
    const cap = captureIO();

    const code = await runCli(["report", "--json"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("usage: relayos report");
  });

  it("mentions report in the top-level dispatcher usage", async () => {
    const cap = captureIO();

    const code = await runCli(["bogus-command"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("report");
  });
});
