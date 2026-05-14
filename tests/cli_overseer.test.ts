import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

const cleanups: Array<() => void> = [];
let previousCwd: string | undefined;

afterEach(() => {
  if (previousCwd) {
    process.chdir(previousCwd);
    previousCwd = undefined;
  }
  while (cleanups.length) cleanups.pop()!();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "relayos-overseer-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function chdir(dir: string) {
  previousCwd = process.cwd();
  process.chdir(dir);
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

describe("relayos overseer status", () => {
  it("prints a no-state message when the workspace is empty", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "status"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("OVERSEER STATUS");
    expect(cap.stdout).toContain("no overseer state");
    expect(cap.stderr).toBe("");
  });

  it("shows the next action after it is set", async () => {
    chdir(tempDir());
    const cap = captureIO();
    await runCli(["overseer", "next", "deploy the patch"], cap.io);

    const cap2 = captureIO();
    const code = await runCli(["overseer", "status"], cap2.io);

    expect(code).toBe(0);
    expect(cap2.stdout).toContain("NEXT ACTION");
    expect(cap2.stdout).toContain("deploy the patch");
  });

  it("shows recent notes after they are added", async () => {
    chdir(tempDir());
    await runCli(["overseer", "note", "first note"], captureIO().io);
    await runCli(["overseer", "note", "second note"], captureIO().io);

    const cap = captureIO();
    const code = await runCli(["overseer", "status"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("RECENT NOTES");
    expect(cap.stdout).toContain("first note");
    expect(cap.stdout).toContain("second note");
  });
});

describe("relayos overseer note", () => {
  it("records a note and exits 0", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "note", "test", "note", "text"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("note recorded");
    expect(cap.stdout).toContain("test note text");
    expect(cap.stderr).toBe("");
  });

  it("exits 1 with usage when no text is given", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "note"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("usage: relayos overseer note");
  });
});

describe("relayos overseer next", () => {
  it("sets and prints the next action", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "next", "run", "full", "suite"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("run full suite");
    expect(cap.stderr).toBe("");
  });

  it("reads back the current next action when called with no args", async () => {
    chdir(tempDir());
    await runCli(["overseer", "next", "review PR #42"], captureIO().io);

    const cap = captureIO();
    const code = await runCli(["overseer", "next"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("review PR #42");
  });

  it("prints a no-data message when no next action is set", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "next"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("no next action set");
    expect(cap.stderr).toBe("");
  });

  it("overwrites the previous next action", async () => {
    chdir(tempDir());
    await runCli(["overseer", "next", "old action"], captureIO().io);
    await runCli(["overseer", "next", "new action"], captureIO().io);

    const cap = captureIO();
    await runCli(["overseer", "next"], cap.io);

    expect(cap.stdout).toContain("new action");
    expect(cap.stdout).not.toContain("old action");
  });
});

describe("relayos overseer: error cases", () => {
  it("exits 1 with usage on unknown subcommand", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "bogus"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("usage: relayos overseer");
  });

  it("exits 1 with usage when no subcommand is given", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("usage: relayos overseer");
  });

  it("mentions overseer in the top-level dispatcher usage", async () => {
    const cap = captureIO();

    const code = await runCli(["bad-command"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("overseer");
  });
});
