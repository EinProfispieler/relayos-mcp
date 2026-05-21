/**
 * Tests for `overseer run <subcommand>` (Plan Task 5).
 *
 * Drives the CLI directly through `runCli()` with a captured IO. Each test
 * uses its own temp project root and `process.chdir`'s into it so the
 * Run Ledger helpers (which key off `process.cwd()`) write into the
 * sandbox, not the developer's repo.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

function captureIO() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: { write: (c: string) => (stdout += c) },
      stderr: { write: (c: string) => (stderr += c) },
    },
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

let cwd: string;
let originalCwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "run-ledger-cli-"));
  await mkdir(join(cwd, ".relayos", "overseer"), { recursive: true });
  originalCwd = process.cwd();
  process.chdir(cwd);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(cwd, { recursive: true, force: true });
});

const ACTIVE = [".relayos", "overseer", "active_run.json"] as const;

describe("overseer run start", () => {
  it("creates active_run.json and prints r_<ULID>", async () => {
    const cap = captureIO();
    const code = await runCli(
      ["overseer", "run", "start", "--goal", "test run"],
      cap.io,
    );
    expect(code).toBe(0);
    const id = cap.stdout.trim();
    expect(id).toMatch(/^r_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(existsSync(join(cwd, ...ACTIVE))).toBe(true);
  });

  it("is idempotent — second start returns the same id", async () => {
    const a = captureIO();
    await runCli(["overseer", "run", "start"], a.io);
    const id1 = a.stdout.trim();
    const b = captureIO();
    await runCli(["overseer", "run", "start"], b.io);
    const id2 = b.stdout.trim();
    expect(id2).toBe(id1);
  });
});

describe("overseer run current", () => {
  it("errors when no active run", async () => {
    const cap = captureIO();
    const code = await runCli(["overseer", "run", "current"], cap.io);
    expect(code).toBe(1);
    expect(cap.stderr).toContain("No active run");
  });

  it("returns run + empty recent_tasks + null continuation after start", async () => {
    await runCli(["overseer", "run", "start", "--goal", "ttt"], captureIO().io);
    const cap = captureIO();
    const code = await runCli(["overseer", "run", "current"], cap.io);
    expect(code).toBe(0);
    const obj = JSON.parse(cap.stdout);
    expect(obj.run.status).toBe("active");
    expect(obj.run.goal).toBe("ttt");
    expect(obj.recent_tasks).toEqual([]);
    expect(obj.continuation).toBeNull();
  });
});

describe("overseer run compact", () => {
  it("writes continuation.json", async () => {
    const startCap = captureIO();
    await runCli(["overseer", "run", "start", "--goal", "compact me"], startCap.io);
    const id = startCap.stdout.trim();
    const cap = captureIO();
    const code = await runCli(["overseer", "run", "compact"], cap.io);
    expect(code).toBe(0);
    const packet = JSON.parse(cap.stdout);
    expect(packet.run_id).toBe(id);
    expect(packet.context_summary).toBe("compact me");
    expect(
      existsSync(
        join(cwd, ".relayos", "overseer", "runs", id, "continuation.json"),
      ),
    ).toBe(true);
  });
});

describe("overseer run complete", () => {
  it("marks run completed and deletes active_run.json", async () => {
    await runCli(["overseer", "run", "start"], captureIO().io);
    const cap = captureIO();
    const code = await runCli(["overseer", "run", "complete"], cap.io);
    expect(code).toBe(0);
    expect(cap.stdout).toMatch(/Run r_[0-9A-Z]{26} completed/);
    expect(existsSync(join(cwd, ...ACTIVE))).toBe(false);
  });
});

describe("overseer run abandon", () => {
  it("marks run abandoned, deletes active_run.json, and blocks resume", async () => {
    const start = captureIO();
    await runCli(["overseer", "run", "start"], start.io);
    const id = start.stdout.trim();
    await runCli(["overseer", "run", "abandon"], captureIO().io);
    expect(existsSync(join(cwd, ...ACTIVE))).toBe(false);
    const resume = captureIO();
    const code = await runCli(["overseer", "run", "resume", id], resume.io);
    expect(code).toBe(1);
    expect(resume.stderr).toContain("abandoned");
  });
});

describe("overseer run resume", () => {
  it("requires a run id", async () => {
    const cap = captureIO();
    const code = await runCli(["overseer", "run", "resume"], cap.io);
    expect(code).toBe(1);
    expect(cap.stderr).toContain("Usage");
  });

  it("fails for unknown run id", async () => {
    const cap = captureIO();
    const code = await runCli(
      ["overseer", "run", "resume", "r_01NOPE000000000000000000000"],
      cap.io,
    );
    expect(code).toBe(1);
    expect(cap.stderr).toContain("not found");
  });

  it("sets the named run as active and returns continuation (null if missing)", async () => {
    const start = captureIO();
    await runCli(["overseer", "run", "start"], start.io);
    const id = start.stdout.trim();
    await runCli(["overseer", "run", "complete"], captureIO().io);

    const cap = captureIO();
    const code = await runCli(["overseer", "run", "resume", id], cap.io);
    expect(code).toBe(0);
    const obj = JSON.parse(cap.stdout);
    expect(obj.resumed).toBe(id);
    expect(obj.continuation).toBeNull();
    expect(existsSync(join(cwd, ...ACTIVE))).toBe(true);
  });
});

describe("overseer run list", () => {
  it("returns [] when no runs exist", async () => {
    const cap = captureIO();
    const code = await runCli(["overseer", "run", "list"], cap.io);
    expect(code).toBe(0);
    expect(JSON.parse(cap.stdout)).toEqual([]);
  });

  it("returns the completed run sorted by started_at desc", async () => {
    const a = captureIO();
    await runCli(["overseer", "run", "start", "--goal", "first"], a.io);
    await runCli(["overseer", "run", "complete"], captureIO().io);
    const cap = captureIO();
    const code = await runCli(["overseer", "run", "list"], cap.io);
    expect(code).toBe(0);
    const arr = JSON.parse(cap.stdout);
    expect(Array.isArray(arr)).toBe(true);
    expect(arr).toHaveLength(1);
    expect(arr[0].goal).toBe("first");
    expect(arr[0].status).toBe("completed");
  });
});

describe("overseer run <unknown>", () => {
  it("prints usage and returns 1", async () => {
    const cap = captureIO();
    const code = await runCli(["overseer", "run", "fly-me-to-the-moon"], cap.io);
    expect(code).toBe(1);
    expect(cap.stderr).toContain("Unknown run subcommand");
  });
});
