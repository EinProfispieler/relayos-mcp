import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { tempLayout } from "./_helpers.js";

const exec = promisify(execFile);

const cleanups: Array<() => void> = [];
let previousHandoffDir: string | undefined;
let previousCwd: string | undefined;

afterEach(() => {
  if (previousHandoffDir === undefined) {
    delete process.env.HANDOFF_DIR;
  } else {
    process.env.HANDOFF_DIR = previousHandoffDir;
  }
  previousHandoffDir = undefined;
  if (previousCwd) {
    process.chdir(previousCwd);
    previousCwd = undefined;
  }
  while (cleanups.length) cleanups.pop()!();
});

async function withLayout() {
  const temp = await tempLayout();
  cleanups.push(temp.cleanup);
  previousHandoffDir = process.env.HANDOFF_DIR;
  process.env.HANDOFF_DIR = temp.layout.root;
  return temp;
}

async function tempGitRepo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "relayos-cli-checkpoint-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  await exec("git", ["init", "--quiet", "--initial-branch=main"], { cwd: dir });
  await exec("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await exec("git", ["config", "user.name", "Test"], { cwd: dir });
  await exec("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  writeFileSync(join(dir, "tracked.txt"), "hello\n");
  await exec("git", ["add", "tracked.txt"], { cwd: dir });
  await exec("git", ["commit", "--quiet", "-m", "init"], { cwd: dir });
  writeFileSync(join(dir, "tracked.txt"), "hello world\n");
  writeFileSync(join(dir, "new.txt"), "fresh\n");
  return dir;
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

describe("relayos checkpoint create", () => {
  it("prints id + saved paths for a dirty git repo", async () => {
    await withLayout();
    const repo = await tempGitRepo();
    chdir(repo);
    const cap = captureIO();

    const code = await runCli(["checkpoint", "create"], cap.io);

    expect(code).toBe(0);
    expect(cap.stderr).toBe("");
    expect(cap.stdout).toMatch(/^checkpoint c_[0-9A-HJKMNP-TV-Z]{26}\n/);
    expect(cap.stdout).toContain("status:");
    expect(cap.stdout).toContain("diff:");
    expect(cap.stdout).toContain("untracked:");
    expect(cap.stdout).toContain("branch: main");
    expect(cap.stdout).toContain("dirty: yes");
  });

  it("accepts --message <msg>", async () => {
    await withLayout();
    const repo = await tempGitRepo();
    chdir(repo);
    const cap = captureIO();

    const code = await runCli(
      ["checkpoint", "create", "--message", "pre-codex review"],
      cap.io,
    );

    expect(code).toBe(0);
    expect(cap.stdout).toContain("checkpoint c_");
  });

  it("rejects unknown flags with usage", async () => {
    await withLayout();
    const cap = captureIO();

    const code = await runCli(["checkpoint", "create", "--whatever"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("usage: relayos checkpoint create");
  });

  it("notes when cwd is not a git repo but still succeeds", async () => {
    await withLayout();
    const nonRepo = mkdtempSync(join(tmpdir(), "relayos-cli-nongit-"));
    cleanups.push(() => rmSync(nonRepo, { recursive: true, force: true }));
    chdir(nonRepo);
    const cap = captureIO();

    const code = await runCli(["checkpoint", "create"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("checkpoint c_");
    expect(cap.stderr).toContain("not inside a git working tree");
  });
});

describe("relayos checkpoint list", () => {
  it("lists newly-created checkpoints newest first", async () => {
    await withLayout();
    const repo = await tempGitRepo();
    chdir(repo);

    const a = captureIO();
    await runCli(["checkpoint", "create"], a.io);
    await new Promise((r) => setTimeout(r, 5));
    const b = captureIO();
    await runCli(["checkpoint", "create"], b.io);

    const list = captureIO();
    const code = await runCli(["checkpoint", "list"], list.io);

    expect(code).toBe(0);
    const lines = list.stdout.trim().split("\n").filter((l) => l.startsWith("c_"));
    expect(lines.length).toBe(2);
    const idFromA = a.stdout.match(/c_[0-9A-HJKMNP-TV-Z]{26}/)![0];
    const idFromB = b.stdout.match(/c_[0-9A-HJKMNP-TV-Z]{26}/)![0];
    expect(lines[0]).toContain(idFromB);
    expect(lines[1]).toContain(idFromA);
  });

  it("emits a helpful note (not an error) when empty", async () => {
    await withLayout();
    const cap = captureIO();

    const code = await runCli(["checkpoint", "list"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toBe("");
    expect(cap.stderr).toContain("no checkpoints found");
  });
});

describe("relayos checkpoint show", () => {
  it("prints metadata block for a created checkpoint", async () => {
    await withLayout();
    const repo = await tempGitRepo();
    chdir(repo);

    const create = captureIO();
    await runCli(["checkpoint", "create"], create.io);
    const id = create.stdout.match(/c_[0-9A-HJKMNP-TV-Z]{26}/)![0];

    const cap = captureIO();
    const code = await runCli(["checkpoint", "show", id], cap.io);

    expect(code).toBe(0);
    expect(cap.stderr).toBe("");
    expect(cap.stdout).toContain(`id:         ${id}`);
    expect(cap.stdout).toContain("branch:     main");
    expect(cap.stdout).toContain("dirty:      yes");
    expect(cap.stdout).toContain("# cat ");
    expect(cap.stdout).toContain(".diff");
  });

  it("supports the latest selector", async () => {
    await withLayout();
    const repo = await tempGitRepo();
    chdir(repo);
    const create = captureIO();
    await runCli(["checkpoint", "create"], create.io);
    const id = create.stdout.match(/c_[0-9A-HJKMNP-TV-Z]{26}/)![0];

    const cap = captureIO();
    const code = await runCli(["checkpoint", "show", "latest"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain(`id:         ${id}`);
  });

  it("exits 1 with relayos checkpoint: prefix for unknown id", async () => {
    await withLayout();
    const cap = captureIO();

    const code = await runCli(
      ["checkpoint", "show", "c_DOES_NOT_EXIST"],
      cap.io,
    );

    expect(code).toBe(1);
    expect(cap.stderr).toContain("relayos checkpoint:");
    expect(cap.stderr).toContain("was not found");
    expect(cap.stdout).toBe("");
  });
});

describe("relayos checkpoint usage", () => {
  it("emits subcommand usage for an unknown subcommand", async () => {
    const cap = captureIO();

    const code = await runCli(["checkpoint", "whatever"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("usage: relayos checkpoint");
  });
});
