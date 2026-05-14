import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

const cleanups: Array<() => void> = [];
let previousCwd: string | undefined;
const REPO_ROOT = process.cwd();

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

  it("prints stable JSON with null/empty values when overseer state is missing", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "status", "--json"], cap.io);

    expect(code).toBe(0);
    const data = JSON.parse(cap.stdout) as Record<string, unknown>;
    expect(data.project).toBeNull();
    expect(data.currentState).toBeNull();
    expect(data.nextAction).toBeNull();
    expect(data.activeBranch).toBeNull();
    expect(Array.isArray(data.branchProgress)).toBe(true);
    expect((data.branchProgress as unknown[]).length).toBe(0);
    expect(data.latestCommit === null || typeof data.latestCommit === "string").toBe(true);
    expect(Array.isArray(data.notes)).toBe(true);
    expect((data.notes as unknown[]).length).toBe(0);
    expect(cap.stderr).toBe("");
  });

  it("prints stable JSON with populated values", async () => {
    chdir(tempDir());
    await runCli(["overseer", "next", "ship the patch"], captureIO().io);
    await runCli(["overseer", "branch", "my-feature"], captureIO().io);
    await runCli(["overseer", "progress", "first entry"], captureIO().io);
    await runCli(["overseer", "note", "first note"], captureIO().io);
    const cap = captureIO();

    const code = await runCli(["overseer", "status", "--json"], cap.io);

    expect(code).toBe(0);
    const data = JSON.parse(cap.stdout) as Record<string, unknown>;
    expect(data.nextAction).toBe("ship the patch");
    expect(data.activeBranch).toBe("my-feature");
    expect(Array.isArray(data.branchProgress)).toBe(true);
    expect((data.branchProgress as string[]).some((line) => line.includes("first entry"))).toBe(true);
    expect(Array.isArray(data.notes)).toBe(true);
    expect((data.notes as string[]).some((line) => line.includes("first note"))).toBe(true);
    expect(cap.stderr).toBe("");
  });

  it("exits 1 with usage on unsupported flag", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "status", "--yaml"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("usage: relayos overseer status");
  });
});

describe("relayos overseer recent", () => {
  const REQUIRED_RECENT_JSON_FIELDS = [
    "project",
    "currentState",
    "activeBranch",
    "nextAction",
    "mode",
    "runtime",
    "warnings",
  ] as const;

  it("prints a compact human-readable summary", async () => {
    chdir(tempDir());
    await runCli(["overseer", "next", "ship the patch"], captureIO().io);
    await runCli(["overseer", "branch", "my-feature"], captureIO().io);
    const cap = captureIO();

    const code = await runCli(["overseer", "recent"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("OVERSEER RECENT");
    expect(cap.stdout).toContain("project:");
    expect(cap.stdout).toContain("state anchor:");
    expect(cap.stdout).toContain("active branch/task: my-feature");
    expect(cap.stdout).toContain("next action: ship the patch");
    expect(cap.stdout).toContain("mode: serial (default)");
    expect(cap.stdout).toContain("runtime posture:");
    expect(cap.stderr).toBe("");
  });

  it("degrades gracefully when optional local files are missing", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "recent"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("project: not available");
    expect(cap.stdout).toContain("active branch/task: not available");
    expect(cap.stdout).toContain("next action: not available");
    expect(cap.stderr).toBe("");
  });

  it("prints stable JSON summary output", async () => {
    chdir(tempDir());
    await runCli(["overseer", "next", "ship the patch"], captureIO().io);
    await runCli(["overseer", "branch", "my-feature"], captureIO().io);
    const cap = captureIO();

    const code = await runCli(["overseer", "recent", "--json"], cap.io);

    expect(code).toBe(0);
    const data = JSON.parse(cap.stdout) as Record<string, unknown>;
    for (const key of REQUIRED_RECENT_JSON_FIELDS) expect(key in data).toBe(true);
    expect(data.activeBranch).toBe("my-feature");
    expect(data.nextAction).toBe("ship the patch");
    expect((data.mode as Record<string, unknown>).current).toBe("serial");
    expect((data.runtime as Record<string, unknown>).runtimeWorkspaceSwitchingActive).toBe(false);
    expect(Array.isArray(data.warnings)).toBe(true);
    expect(cap.stderr).toBe("");
  });

  it("prints JSON with null/unavailable values without crashing when optional files are missing", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "recent", "--json"], cap.io);

    expect(code).toBe(0);
    const data = JSON.parse(cap.stdout) as Record<string, unknown>;
    for (const key of REQUIRED_RECENT_JSON_FIELDS) expect(key in data).toBe(true);
    expect(data.project).toBeNull();
    expect((data.currentState as Record<string, unknown>).raw).toBeNull();
    expect(data.activeBranch).toBeNull();
    expect(data.nextAction).toBeNull();
    expect(Array.isArray(data.warnings)).toBe(true);
    expect((data.warnings as string[]).length).toBeGreaterThan(0);
    expect(cap.stderr).toBe("");
  });

  it("does not write overseer state", async () => {
    const cwd = tempDir();
    chdir(cwd);
    const cap = captureIO();

    const code = await runCli(["overseer", "recent"], cap.io);

    expect(code).toBe(0);
    expect(existsSync(join(cwd, ".relayos", "overseer"))).toBe(false);
  });

  it("remains read-only in JSON mode", async () => {
    const cwd = tempDir();
    chdir(cwd);
    const cap = captureIO();

    const code = await runCli(["overseer", "recent", "--json"], cap.io);

    expect(code).toBe(0);
    expect(existsSync(join(cwd, ".relayos", "overseer"))).toBe(false);
  });

  it("keeps human-readable output behavior", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "recent"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("OVERSEER RECENT");
    expect(cap.stdout).toContain("mode: serial (default)");
    expect(cap.stdout).toContain("runtime posture:");
  });

  it("exits 1 with usage on unsupported flag", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "recent", "--yaml"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("usage: relayos overseer recent");
  });
});

describe("relayos overseer context", () => {
  const REQUIRED_CONTEXT_JSON_FIELDS = [
    "ok",
    "workspace_path",
    "files",
    "missing",
    "gitignored",
  ] as const;

  it("prints compact human-readable context availability", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "context"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("OVERSEER CONTEXT");
    expect(cap.stdout).toContain("workspace:");
    expect(cap.stdout).toContain("CANONICAL FILES");
    expect(cap.stdout).toContain("[ ] PROJECT_BRIEF.md");
    expect(cap.stdout).toContain("MISSING");
    expect(cap.stderr).toBe("");
  });

  it("prints stable JSON context output", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "context", "--json"], cap.io);

    expect(code).toBe(0);
    const data = JSON.parse(cap.stdout) as Record<string, unknown>;
    for (const key of REQUIRED_CONTEXT_JSON_FIELDS) expect(key in data).toBe(true);
    expect(typeof data.ok).toBe("boolean");
    expect(typeof data.workspace_path).toBe("string");
    expect(Array.isArray(data.files)).toBe(true);
    expect(Array.isArray(data.missing)).toBe(true);
    expect(
      data.gitignored === null ||
        typeof data.gitignored === "boolean",
    ).toBe(true);
    expect(cap.stderr).toBe("");
  });

  it("does not create overseer directories or files", async () => {
    const cwd = tempDir();
    chdir(cwd);
    const cap = captureIO();

    const code = await runCli(["overseer", "context"], cap.io);

    expect(code).toBe(0);
    expect(existsSync(join(cwd, ".relayos", "overseer"))).toBe(false);
  });

  it("reports gitignored=true from repo root", async () => {
    chdir(REPO_ROOT);
    const cap = captureIO();

    const code = await runCli(["overseer", "context", "--json"], cap.io);

    expect(code).toBe(0);
    const data = JSON.parse(cap.stdout) as Record<string, unknown>;
    expect(data.gitignored).toBe(true);
  });

  it("exits 1 with usage on unsupported flag", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "context", "--yaml"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("usage: relayos overseer context");
  });
});

describe("relayos overseer handshake", () => {
  const REQUIRED_HANDSHAKE_JSON_FIELDS = [
    "ok",
    "protocol",
    "session_role",
    "repo_path",
    "workspace_path",
    "context_complete",
    "files",
    "missing",
    "must_read",
    "next_action_source",
    "forbidden_actions",
    "requires_explicit_user_approval_for",
    "notes",
  ] as const;

  it("prints compact human-readable handshake output", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "handshake"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("OVERSEER HANDSHAKE");
    expect(cap.stdout).toContain("protocol: relayos-overseer-session-v1");
    expect(cap.stdout).toContain("session_role: overseer_client");
    expect(cap.stdout).toContain("repo path:");
    expect(cap.stdout).toContain("workspace path:");
    expect(cap.stdout).toContain("context status: incomplete");
    expect(cap.stdout).toContain("next action source:");
    expect(cap.stdout).toContain("forbidden actions:");
    expect(cap.stdout).toContain("No daemon/background agent behavior.");
    expect(cap.stdout).toContain("requires explicit user approval for:");
    expect(cap.stdout).toContain("Tags or releases.");
    expect(cap.stdout).toContain("notes:");
    expect(cap.stdout).toContain("Human-supervised local-first overseer protocol");
    expect(cap.stderr).toBe("");
  });

  it("prints stable JSON handshake output", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "handshake", "--json"], cap.io);

    expect(code).toBe(0);
    const data = JSON.parse(cap.stdout) as Record<string, unknown>;
    for (const key of REQUIRED_HANDSHAKE_JSON_FIELDS) expect(key in data).toBe(true);
    expect(data.ok).toBe(false);
    expect(data.protocol).toBe("relayos-overseer-session-v1");
    expect(data.session_role).toBe("overseer_client");
    expect(data.context_complete).toBe(false);
    expect(Array.isArray(data.files)).toBe(true);
    expect(Array.isArray(data.missing)).toBe(true);
    expect(Array.isArray(data.must_read)).toBe(true);
    expect(Array.isArray(data.forbidden_actions)).toBe(true);
    expect(Array.isArray(data.requires_explicit_user_approval_for)).toBe(true);
    expect(Array.isArray(data.notes)).toBe(true);
    expect(cap.stderr).toBe("");
  });

  it("reports complete context in JSON when canonical files exist", async () => {
    chdir(REPO_ROOT);
    const cap = captureIO();

    const code = await runCli(["overseer", "handshake", "--json"], cap.io);

    expect(code).toBe(0);
    const data = JSON.parse(cap.stdout) as Record<string, unknown>;
    expect(data.context_complete).toBe(true);
    expect(data.ok).toBe(true);
  });

  it("does not create overseer directories or files", async () => {
    const cwd = tempDir();
    chdir(cwd);
    const cap = captureIO();

    const code = await runCli(["overseer", "handshake"], cap.io);

    expect(code).toBe(0);
    expect(existsSync(join(cwd, ".relayos", "overseer"))).toBe(false);
  });

  it("exits 1 with usage on unsupported flag", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "handshake", "--yaml"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("usage: relayos overseer handshake");
  });
});

describe("relayos overseer context-pack", () => {
  it("prints compact human-readable context pack output", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "context-pack"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("OVERSEER CONTEXT PACK");
    expect(cap.stdout).toContain("protocol: relayos-overseer-session-v1");
    expect(cap.stdout).toContain("recent notes (0/8):");
    expect(cap.stdout).toContain("recommended prompt:");
    expect(cap.stdout).toContain("evidence links:");
    expect(cap.stderr).toBe("");
  });

  it("prints stable JSON and honors --limit", async () => {
    const cwd = tempDir();
    chdir(cwd);
    const dir = join(cwd, ".relayos", "overseer");
    rmSync(dir, { recursive: true, force: true });
    await runCli(["overseer", "note", "one"], captureIO().io);
    await runCli(["overseer", "note", "two"], captureIO().io);
    await runCli(["overseer", "note", "three"], captureIO().io);
    const cap = captureIO();

    const code = await runCli(["overseer", "context-pack", "--json", "--limit", "2"], cap.io);

    expect(code).toBe(0);
    const data = JSON.parse(cap.stdout) as Record<string, unknown>;
    expect(data.tool).toBe("read_overseer_context_pack");
    expect(data.protocol).toBe("relayos-overseer-session-v1");
    expect(data.limit).toBe(2);
    expect(data.notes_count).toBe(2);
    expect(Array.isArray(data.recent_notes)).toBe(true);
    expect((data.recent_notes as Array<Record<string, string>>).map((n) => n.text)).toEqual([
      "two",
      "three",
    ]);
    expect(cap.stderr).toBe("");
  });

  it("stays read-only when context is missing", async () => {
    const cwd = tempDir();
    chdir(cwd);
    const cap = captureIO();

    const code = await runCli(["overseer", "context-pack"], cap.io);

    expect(code).toBe(0);
    expect(existsSync(join(cwd, ".relayos", "overseer"))).toBe(false);
  });

  it("exits 1 with usage on invalid flags or invalid limit", async () => {
    chdir(tempDir());
    const capFlag = captureIO();
    const codeFlag = await runCli(["overseer", "context-pack", "--yaml"], capFlag.io);
    expect(codeFlag).toBe(1);
    expect(capFlag.stderr).toContain("usage: relayos overseer context-pack");

    const capLimit = captureIO();
    const codeLimit = await runCli(["overseer", "context-pack", "--limit", "21"], capLimit.io);
    expect(codeLimit).toBe(1);
    expect(capLimit.stderr).toContain("usage: relayos overseer context-pack");
  });
});

describe("relayos overseer run-preflight", () => {
  it("prints compact human-readable preflight output", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "run-preflight"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("OVERSEER RUN PREFLIGHT");
    expect(cap.stdout).toContain("context status:");
    expect(cap.stdout).toContain("ready for future run:");
    expect(cap.stdout).toContain("Preflight only: no run was created.");
    expect(cap.stdout).toContain("No agent process was started.");
    expect(cap.stderr).toBe("");
  });

  it("prints stable JSON output", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "run-preflight", "--json"], cap.io);

    expect(code).toBe(0);
    const data = JSON.parse(cap.stdout) as Record<string, unknown>;
    expect(data.ok).toBe(true);
    expect(data.tool).toBe("run-preflight");
    expect(typeof data.workspace_path).toBe("string");
    expect(typeof data.context_complete).toBe("boolean");
    expect(Array.isArray(data.missing)).toBe(true);
    expect(Array.isArray(data.checks)).toBe(true);
    expect(typeof data.recent_notes_count).toBe("number");
    expect(data.runtime_active).toBe(false);
    expect(data.runner_active).toBe(false);
    expect(data.queue_active).toBe(false);
    expect(typeof data.ready_for_future_run).toBe("boolean");
    expect(Array.isArray(data.notes)).toBe(true);
    expect(cap.stderr).toBe("");
  });

  it("degrades gracefully with missing context", async () => {
    const cwd = tempDir();
    chdir(cwd);
    const cap = captureIO();

    const code = await runCli(["overseer", "run-preflight", "--json"], cap.io);

    expect(code).toBe(0);
    const data = JSON.parse(cap.stdout) as Record<string, unknown>;
    expect(data.context_complete).toBe(false);
    expect(Array.isArray(data.missing)).toBe(true);
  });

  it("does not create .relayos/overseer state", async () => {
    const cwd = tempDir();
    chdir(cwd);
    const cap = captureIO();

    const code = await runCli(["overseer", "run-preflight"], cap.io);

    expect(code).toBe(0);
    expect(existsSync(join(cwd, ".relayos", "overseer"))).toBe(false);
  });

  it("exits 1 with usage on unsupported flags", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "run-preflight", "--yaml"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("usage: relayos overseer run-preflight");
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

  it("appends JSONL entries with ts/text shape and preserves order", async () => {
    const cwd = tempDir();
    chdir(cwd);

    await runCli(["overseer", "note", "first note"], captureIO().io);
    await runCli(["overseer", "note", "second note"], captureIO().io);

    const timelinePath = join(cwd, ".relayos", "overseer", "timeline.jsonl");
    const lines = readFileSync(timelinePath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { ts: string; text: string });

    expect(lines).toHaveLength(2);
    expect(Object.keys(lines[0] ?? {}).sort()).toEqual(["text", "ts"]);
    expect(Object.keys(lines[1] ?? {}).sort()).toEqual(["text", "ts"]);
    expect(typeof lines[0]?.ts).toBe("string");
    expect(lines[0]?.ts.length).toBeGreaterThan(0);
    expect(lines[0]?.text).toBe("first note");
    expect(lines[1]?.text).toBe("second note");
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
    expect(cap.stderr).toContain("recent");
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

describe("relayos overseer start", () => {
  it("prints banner, startup mode guidance, and overseer brief", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "start"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("Local-first safety, audit, and handoff layer");
    expect(cap.stdout).toContain("OVERSEER STARTUP MODE");
    expect(cap.stdout).toContain("Serial mode is the default");
    expect(cap.stdout).toContain("Write tasks are processed one at a time.");
    expect(cap.stdout).toContain("Parallel mode is future/opt-in");
    expect(cap.stdout).toContain("RELAYOS OVERSEER BRIEF");
    expect(cap.stderr).toBe("");
  });

  it("prints stable JSON startup output", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "start", "--json"], cap.io);

    expect(code).toBe(0);
    const data = JSON.parse(cap.stdout) as Record<string, unknown>;
    expect(data.startupMode).toBe("overseer");
    expect(data.currentMode).toBe("serial");
    expect(data.defaultMode).toBe("serial");
    expect(data.parallelModeAvailable).toBe(false);
    expect(data.parallelModeEnabled).toBe(false);
    expect(data.runtimeWorkspaceSwitchingActive).toBe(false);
    expect(data.startsSubruns).toBe(false);
    expect(data.createsBranchesOrWorktrees).toBe(false);
    expect(data.writesRuntimeState).toBe(false);
    expect(Array.isArray(data.notes)).toBe(true);
    const notes = (data.notes as string[]).join(" ");
    expect(notes).toContain("current/default mode");
    expect(notes).toContain("future/opt-in");
    expect(notes).toContain("does not launch Codex/Claude sub-runs");
    expect(notes).toContain("not active yet");
    expect(cap.stderr).toBe("");
  });

  it("exits 1 with usage on unsupported flag", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "start", "--yaml"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("usage: relayos overseer start");
  });
});

describe("relayos overseer mode", () => {
  it("prints the current read-only execution mode guidance", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "mode"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("OVERSEER MODE");
    expect(cap.stdout).toContain("Current/default mode: serial.");
    expect(cap.stdout).toContain("Write tasks are processed one at a time.");
    expect(cap.stdout).toContain("Parallel mode is future/opt-in");
    expect(cap.stderr).toBe("");
  });

  it("exits 1 with usage on unexpected args", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "mode", "json"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("usage: relayos overseer mode");
  });

  it("prints stable JSON mode output", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "mode", "--json"], cap.io);

    expect(code).toBe(0);
    const data = JSON.parse(cap.stdout) as Record<string, unknown>;
    expect(data.currentMode).toBe("serial");
    expect(data.defaultMode).toBe("serial");
    expect(data.parallelModeAvailable).toBe(false);
    expect(data.parallelModeEnabled).toBe(false);
    expect(data.writeTasks).toBe("serial");
    expect(Array.isArray(data.notes)).toBe(true);
    const notes = (data.notes as string[]).join(" ");
    expect(notes).toContain("current/default mode");
    expect(notes).toContain("one at a time");
    expect(notes).toContain("future/opt-in");
    expect(cap.stderr).toBe("");
  });

  it("exits 1 with usage on unsupported flag", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "mode", "--yaml"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("usage: relayos overseer mode");
  });
});

describe("relayos overseer env", () => {
  it("prints cwd and reports runtime workspace as not configured when RELAYOS_RUNTIME_HOME is unset", async () => {
    chdir(tempDir());
    const prev = process.env.RELAYOS_RUNTIME_HOME;
    delete process.env.RELAYOS_RUNTIME_HOME;
    const cap = captureIO();

    try {
      const code = await runCli(["overseer", "env"], cap.io);
      expect(code).toBe(0);
      expect(cap.stdout).toContain("OVERSEER ENVIRONMENT");
      expect(cap.stdout).toContain(`Current working directory: ${process.cwd()}`);
      expect(cap.stdout).toContain("RELAYOS_RUNTIME_HOME: not set");
      expect(cap.stdout).toContain("Runtime workspace: not configured");
      expect(cap.stdout).toContain("Runtime workspace switching: not active yet.");
      expect(cap.stdout).toContain("`.relayos/` paths resolve relative to the current working directory");
      expect(cap.stdout).toContain("inspection-only in this release");
      expect(cap.stdout).toContain("outside the RelayOS source repo");
      expect(cap.stderr).toBe("");
    } finally {
      if (prev === undefined) delete process.env.RELAYOS_RUNTIME_HOME;
      else process.env.RELAYOS_RUNTIME_HOME = prev;
    }
  });

  it("prints RELAYOS_RUNTIME_HOME when set but keeps support inspection-only", async () => {
    chdir(tempDir());
    const prev = process.env.RELAYOS_RUNTIME_HOME;
    process.env.RELAYOS_RUNTIME_HOME = "/tmp/relayos-runtime";
    const cap = captureIO();

    try {
      const code = await runCli(["overseer", "env"], cap.io);
      expect(code).toBe(0);
      expect(cap.stdout).toContain("RELAYOS_RUNTIME_HOME: configured (/tmp/relayos-runtime)");
      expect(cap.stdout).toContain("value detected for inspection only");
      expect(cap.stdout).toContain("Runtime workspace switching: not active yet.");
      expect(cap.stdout).toContain(
        "RelayOS still resolves `.relayos/` relative to the current working directory unless/until future runtime switching is explicitly implemented.",
      );
      expect(cap.stdout).toContain("inspection-only in this release");
    } finally {
      if (prev === undefined) delete process.env.RELAYOS_RUNTIME_HOME;
      else process.env.RELAYOS_RUNTIME_HOME = prev;
    }
  });

  it("prints stable JSON when RELAYOS_RUNTIME_HOME is unset", async () => {
    chdir(tempDir());
    const prev = process.env.RELAYOS_RUNTIME_HOME;
    delete process.env.RELAYOS_RUNTIME_HOME;
    const cap = captureIO();

    try {
      const code = await runCli(["overseer", "env", "--json"], cap.io);
      expect(code).toBe(0);
      const data = JSON.parse(cap.stdout) as Record<string, unknown>;
      expect(data.cwd).toBe(process.cwd());
      expect(data.relayosRuntimeHomeSet).toBe(false);
      expect(data.relayosRuntimeHome).toBeNull();
      expect(data.runtimeWorkspaceConfigured).toBe(false);
      expect(data.runtimeWorkspaceSwitchingActive).toBe(false);
      expect(data.currentRelayosResolution).toBe("cwd");
      expect(Array.isArray(data.notes)).toBe(true);
      expect((data.notes as string[]).join(" ")).toContain("inspection only");
      expect((data.notes as string[]).join(" ")).toContain("not active yet");
      expect(cap.stderr).toBe("");
    } finally {
      if (prev === undefined) delete process.env.RELAYOS_RUNTIME_HOME;
      else process.env.RELAYOS_RUNTIME_HOME = prev;
    }
  });

  it("prints stable JSON when RELAYOS_RUNTIME_HOME is set", async () => {
    chdir(tempDir());
    const prev = process.env.RELAYOS_RUNTIME_HOME;
    process.env.RELAYOS_RUNTIME_HOME = "/tmp/relayos-runtime";
    const cap = captureIO();

    try {
      const code = await runCli(["overseer", "env", "--json"], cap.io);
      expect(code).toBe(0);
      const data = JSON.parse(cap.stdout) as Record<string, unknown>;
      expect(data.cwd).toBe(process.cwd());
      expect(data.relayosRuntimeHomeSet).toBe(true);
      expect(data.relayosRuntimeHome).toBe("/tmp/relayos-runtime");
      expect(data.runtimeWorkspaceConfigured).toBe(true);
      expect(data.runtimeWorkspaceSwitchingActive).toBe(false);
      expect(data.currentRelayosResolution).toBe("cwd");
      expect(Array.isArray(data.notes)).toBe(true);
      expect((data.notes as string[]).join(" ")).toContain("inspection only");
      expect((data.notes as string[]).join(" ")).toContain("not active yet");
      expect(cap.stderr).toBe("");
    } finally {
      if (prev === undefined) delete process.env.RELAYOS_RUNTIME_HOME;
      else process.env.RELAYOS_RUNTIME_HOME = prev;
    }
  });

  it("exits 1 with usage on unsupported args", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "env", "--yaml"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("usage: relayos overseer env");
  });
});

describe("relayos overseer activate-runtime --dry-run", () => {
  const REQUIRED_JSON_FIELDS = [
    "decision",
    "sourceRepo",
    "runtimePath",
    "runtimePathExists",
    "runtimePathInsideSourceRepo",
    "runtimePathGitTracked",
    "sourceOverseerStateExists",
    "relayosRuntimeHomeSet",
    "relayosRuntimeHome",
    "relayosRuntimeHomeMatchesPath",
    "runtimeWorkspaceSwitchingActive",
    "wroteFiles",
    "createdDirectories",
    "warnings",
    "blocks",
    "notes",
  ] as const;

  it("exits 1 with usage when no args are provided", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "activate-runtime"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("usage: relayos overseer activate-runtime");
  });

  it("exits 1 with usage when --path is missing", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "activate-runtime", "--dry-run"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("usage: relayos overseer activate-runtime");
  });

  it("exits 1 with usage when --dry-run --json is provided without --path", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(
      ["overseer", "activate-runtime", "--dry-run", "--json"],
      cap.io,
    );

    expect(code).toBe(1);
    expect(cap.stderr).toContain("usage: relayos overseer activate-runtime");
  });

  it("exits 1 with usage when --path is present but value is missing", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(
      ["overseer", "activate-runtime", "--dry-run", "--path"],
      cap.io,
    );

    expect(code).toBe(1);
    expect(cap.stderr).toContain("usage: relayos overseer activate-runtime");
  });

  it("exits 1 with refusal when --dry-run is missing", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(
      ["overseer", "activate-runtime", "--path", "/tmp/relayos-runtime"],
      cap.io,
    );

    expect(code).toBe(1);
    expect(cap.stderr).toContain("--dry-run is required");
  });

  it("keeps filesystem unchanged on argument-validation failures", async () => {
    const cwd = tempDir();
    chdir(cwd);
    const before = readdirSync(cwd).slice().sort();
    const cap = captureIO();

    const code = await runCli(["overseer", "activate-runtime", "--dry-run", "--path"], cap.io);

    const after = readdirSync(cwd).slice().sort();
    expect(code).toBe(1);
    expect(after).toEqual(before);
  });

  it("returns WARN (exit 0) when runtime path does not exist", async () => {
    chdir(tempDir());
    const source = tempDir();
    const runtime = join(tempDir(), "missing-runtime");
    const cap = captureIO();

    const code = await runCli(
      ["overseer", "activate-runtime", "--dry-run", "--source", source, "--path", runtime],
      cap.io,
    );

    expect(code).toBe(0);
    expect(cap.stdout).toContain("OVERSEER RUNTIME ACTIVATION DRY-RUN");
    expect(cap.stdout).toContain("decision: WARN");
    expect(cap.stdout).toContain("does not exist");
  });

  it("prints complete human-readable WARN safety report", async () => {
    chdir(tempDir());
    const source = tempDir();
    const runtime = join(tempDir(), "missing-runtime");
    const cap = captureIO();

    const code = await runCli(
      ["overseer", "activate-runtime", "--dry-run", "--source", source, "--path", runtime],
      cap.io,
    );

    expect(code).toBe(0);
    expect(cap.stdout).toContain("OVERSEER RUNTIME ACTIVATION DRY-RUN");
    expect(cap.stdout).toContain(`source repo: ${source}`);
    expect(cap.stdout).toContain(`proposed runtime path: ${runtime}`);
    expect(cap.stdout).toContain("RELAYOS_RUNTIME_HOME: not set");
    expect(cap.stdout).toContain("runtime path exists: no");
    expect(cap.stdout).toContain("runtime path inside source repo: no");
    expect(cap.stdout).toContain("runtime path appears git-tracked: no");
    expect(cap.stdout).toContain("decision: WARN");
    expect(cap.stdout).toContain("no files were written");
    expect(cap.stdout).toContain("runtime switching is not active");
  });

  it("returns BLOCK (non-zero) when runtime path is inside source repo", async () => {
    chdir(tempDir());
    const source = tempDir();
    const runtime = join(source, ".relayos-runtime");
    const cap = captureIO();

    const code = await runCli(
      ["overseer", "activate-runtime", "--dry-run", "--source", source, "--path", runtime],
      cap.io,
    );

    expect(code).toBe(2);
    expect(cap.stdout).toContain("decision: BLOCK");
    expect(cap.stdout).toContain("inside the source repo");
  });

  it("prints complete human-readable BLOCK safety report", async () => {
    chdir(tempDir());
    const source = tempDir();
    const runtime = join(source, ".relayos-runtime");
    const cap = captureIO();

    const code = await runCli(
      ["overseer", "activate-runtime", "--dry-run", "--source", source, "--path", runtime],
      cap.io,
    );

    expect(code).toBe(2);
    expect(cap.stdout).toContain("OVERSEER RUNTIME ACTIVATION DRY-RUN");
    expect(cap.stdout).toContain(`source repo: ${source}`);
    expect(cap.stdout).toContain(`proposed runtime path: ${runtime}`);
    expect(cap.stdout).toContain("RELAYOS_RUNTIME_HOME: not set");
    expect(cap.stdout).toContain("runtime path exists: no");
    expect(cap.stdout).toContain("runtime path inside source repo: yes");
    expect(cap.stdout).toContain("runtime path appears git-tracked: no");
    expect(cap.stdout).toContain("decision: BLOCK");
    expect(cap.stdout).toContain("no files were written");
    expect(cap.stdout).toContain("runtime switching is not active");
  });

  it("uses provided --source in human output and blocks inside-source runtime paths even when cwd differs", async () => {
    const cwd = tempDir();
    const source = tempDir();
    chdir(cwd);
    const runtime = join(source, "runtime");
    const cap = captureIO();

    const code = await runCli(
      ["overseer", "activate-runtime", "--dry-run", "--source", source, "--path", runtime],
      cap.io,
    );

    expect(code).toBe(2);
    expect(cap.stdout).toContain(`source repo: ${source}`);
    expect(cap.stdout).toContain(`proposed runtime path: ${runtime}`);
    expect(cap.stdout).toContain("runtime path inside source repo: yes");
    expect(cap.stdout).toContain("decision: BLOCK");
  });

  it("returns BLOCK (non-zero) when runtime path appears git-tracked", async () => {
    chdir(tempDir());
    const runtime = join(REPO_ROOT, "README.md");
    const cap = captureIO();

    const code = await runCli(
      [
        "overseer",
        "activate-runtime",
        "--dry-run",
        "--source",
        REPO_ROOT,
        "--path",
        runtime,
      ],
      cap.io,
    );

    expect(code).toBe(2);
    expect(cap.stdout).toContain("decision: BLOCK");
    expect(cap.stdout).toContain("appears git-tracked");
    expect(cap.stdout).toContain("runtime path appears git-tracked: yes");
  });

  it("reports runtimePathGitTracked=true in JSON when runtime path is git-tracked", async () => {
    chdir(tempDir());
    const runtime = join(REPO_ROOT, "README.md");
    const cap = captureIO();

    const code = await runCli(
      [
        "overseer",
        "activate-runtime",
        "--dry-run",
        "--source",
        REPO_ROOT,
        "--path",
        runtime,
        "--json",
      ],
      cap.io,
    );

    expect(code).toBe(2);
    const data = JSON.parse(cap.stdout) as Record<string, unknown>;
    expect(data.decision).toBe("block");
    expect(data.runtimePathGitTracked).toBe(true);
    expect(Array.isArray(data.blocks)).toBe(true);
    expect((data.blocks as string[]).some((b) => b.includes("git-tracked"))).toBe(true);
  });

  it("prints stable JSON for allow path", async () => {
    chdir(tempDir());
    const source = tempDir();
    const runtime = tempDir();
    const cap = captureIO();

    const code = await runCli(
      [
        "overseer",
        "activate-runtime",
        "--dry-run",
        "--source",
        source,
        "--path",
        runtime,
        "--json",
      ],
      cap.io,
    );

    expect(code).toBe(0);
    const data = JSON.parse(cap.stdout) as Record<string, unknown>;
    expect(data.decision).toBe("allow");
    expect(data.sourceRepo).toBe(source);
    expect(data.runtimePath).toBe(runtime);
    expect(data.runtimePathExists).toBe(true);
    expect(data.runtimePathInsideSourceRepo).toBe(false);
    expect(data.runtimePathGitTracked).toBe(false);
    expect(data.sourceOverseerStateExists).toBe(false);
    expect(data.relayosRuntimeHomeSet).toBe(false);
    expect(data.relayosRuntimeHome).toBeNull();
    expect(data.relayosRuntimeHomeMatchesPath).toBe(false);
    expect(data.runtimeWorkspaceSwitchingActive).toBe(false);
    expect(data.wroteFiles).toBe(false);
    expect(data.createdDirectories).toBe(false);
    expect(Array.isArray(data.warnings)).toBe(true);
    expect((data.warnings as unknown[]).length).toBe(0);
    expect(Array.isArray(data.blocks)).toBe(true);
    expect((data.blocks as unknown[]).length).toBe(0);
    expect(Array.isArray(data.notes)).toBe(true);
    for (const key of REQUIRED_JSON_FIELDS) expect(key in data).toBe(true);
    expect(cap.stderr).toBe("");
  });

  it("prints complete human-readable ALLOW safety report", async () => {
    chdir(tempDir());
    const source = tempDir();
    const runtime = tempDir();
    const cap = captureIO();

    const code = await runCli(
      ["overseer", "activate-runtime", "--dry-run", "--source", source, "--path", runtime],
      cap.io,
    );

    expect(code).toBe(0);
    expect(cap.stdout).toContain("OVERSEER RUNTIME ACTIVATION DRY-RUN");
    expect(cap.stdout).toContain(`source repo: ${source}`);
    expect(cap.stdout).toContain(`proposed runtime path: ${runtime}`);
    expect(cap.stdout).toContain("RELAYOS_RUNTIME_HOME: not set");
    expect(cap.stdout).toContain("runtime path exists: yes");
    expect(cap.stdout).toContain("runtime path inside source repo: no");
    expect(cap.stdout).toContain("runtime path appears git-tracked: no");
    expect(cap.stdout).toContain("decision: ALLOW");
    expect(cap.stdout).toContain("no files were written");
    expect(cap.stdout).toContain("runtime switching is not active");
  });

  it("does not block for git-tracked reasons on an external non-tracked runtime path", async () => {
    chdir(tempDir());
    const runtime = tempDir();
    const cap = captureIO();

    const code = await runCli(
      [
        "overseer",
        "activate-runtime",
        "--dry-run",
        "--source",
        REPO_ROOT,
        "--path",
        runtime,
        "--json",
      ],
      cap.io,
    );

    expect(code).toBe(0);
    const data = JSON.parse(cap.stdout) as Record<string, unknown>;
    expect(data.runtimePathGitTracked).toBe(false);
    expect(data.decision).toBe("allow");
    expect(Array.isArray(data.blocks)).toBe(true);
    expect((data.blocks as unknown[]).length).toBe(0);
  });

  it("uses provided --source for inside-source JSON checks when cwd differs", async () => {
    const cwd = tempDir();
    const source = tempDir();
    const runtime = tempDir();
    chdir(cwd);
    const cap = captureIO();

    const code = await runCli(
      [
        "overseer",
        "activate-runtime",
        "--dry-run",
        "--source",
        source,
        "--path",
        runtime,
        "--json",
      ],
      cap.io,
    );

    expect(code).toBe(0);
    const data = JSON.parse(cap.stdout) as Record<string, unknown>;
    expect(data.sourceRepo).toBe(source);
    expect(data.runtimePath).toBe(runtime);
    expect(data.runtimePathInsideSourceRepo).toBe(false);
    expect(data.decision).toBe("allow");
  });

  it("prints stable JSON WARN when RELAYOS_RUNTIME_HOME differs from --path", async () => {
    chdir(tempDir());
    const source = tempDir();
    const runtime = tempDir();
    const prev = process.env.RELAYOS_RUNTIME_HOME;
    process.env.RELAYOS_RUNTIME_HOME = "/tmp/relayos-other";
    const cap = captureIO();

    try {
      const code = await runCli(
        [
          "overseer",
          "activate-runtime",
          "--dry-run",
          "--source",
          source,
          "--path",
          runtime,
          "--json",
        ],
        cap.io,
      );

      expect(code).toBe(0);
      const data = JSON.parse(cap.stdout) as Record<string, unknown>;
      expect(data.decision).toBe("warn");
      expect(data.relayosRuntimeHomeSet).toBe(true);
      expect(data.relayosRuntimeHome).toBe("/tmp/relayos-other");
      expect(data.relayosRuntimeHomeMatchesPath).toBe(false);
      expect(Array.isArray(data.warnings)).toBe(true);
      expect((data.warnings as string[]).some((w) => w.includes("does not match --path"))).toBe(
        true,
      );
      expect((data.blocks as unknown[]).length).toBe(0);
    } finally {
      if (prev === undefined) delete process.env.RELAYOS_RUNTIME_HOME;
      else process.env.RELAYOS_RUNTIME_HOME = prev;
    }
  });

  it("keeps decision=block when inside-source block and warnings both apply", async () => {
    chdir(tempDir());
    const source = tempDir();
    const runtime = join(source, ".relayos-runtime");
    const cap = captureIO();

    const code = await runCli(
      [
        "overseer",
        "activate-runtime",
        "--dry-run",
        "--source",
        source,
        "--path",
        runtime,
        "--json",
      ],
      cap.io,
    );

    expect(code).toBe(2);
    const data = JSON.parse(cap.stdout) as Record<string, unknown>;
    expect(data.decision).toBe("block");
    expect(data.runtimePathInsideSourceRepo).toBe(true);
    expect(Array.isArray(data.warnings)).toBe(true);
    expect((data.warnings as unknown[]).length).toBeGreaterThan(0);
    expect(Array.isArray(data.blocks)).toBe(true);
    expect((data.blocks as unknown[]).length).toBeGreaterThan(0);
  });

  it("keeps decision=block when git-tracked block and env-mismatch warning both apply", async () => {
    chdir(tempDir());
    const runtime = join(REPO_ROOT, "README.md");
    const prev = process.env.RELAYOS_RUNTIME_HOME;
    process.env.RELAYOS_RUNTIME_HOME = "/tmp/relayos-other";
    const cap = captureIO();

    try {
      const code = await runCli(
        [
          "overseer",
          "activate-runtime",
          "--dry-run",
          "--source",
          REPO_ROOT,
          "--path",
          runtime,
          "--json",
        ],
        cap.io,
      );

      expect(code).toBe(2);
      const data = JSON.parse(cap.stdout) as Record<string, unknown>;
      expect(data.decision).toBe("block");
      expect(data.runtimePathGitTracked).toBe(true);
      expect(data.relayosRuntimeHomeSet).toBe(true);
      expect(data.relayosRuntimeHomeMatchesPath).toBe(false);
      expect(Array.isArray(data.warnings)).toBe(true);
      expect((data.warnings as string[]).some((w) => w.includes("does not match --path"))).toBe(
        true,
      );
      expect(Array.isArray(data.blocks)).toBe(true);
      expect((data.blocks as string[]).some((b) => b.includes("git-tracked"))).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.RELAYOS_RUNTIME_HOME;
      else process.env.RELAYOS_RUNTIME_HOME = prev;
    }
  });
});

describe("relayos overseer runtime-check (alias)", () => {
  it("runs the same read-only dry-run checks (human output)", async () => {
    chdir(tempDir());
    const source = tempDir();
    const runtime = join(tempDir(), "missing-runtime");
    const cap = captureIO();

    const code = await runCli(
      ["overseer", "runtime-check", "--source", source, "--path", runtime],
      cap.io,
    );

    expect(code).toBe(0);
    expect(cap.stdout).toContain("OVERSEER RUNTIME ACTIVATION DRY-RUN");
    expect(cap.stdout).toContain(`source repo: ${source}`);
    expect(cap.stdout).toContain(`proposed runtime path: ${runtime}`);
    expect(cap.stdout).toContain("decision: WARN");
    expect(cap.stdout).toContain("no files were written");
    expect(cap.stdout).toContain("runtime switching is not active");
  });

  it("supports --json via the same dry-run path", async () => {
    chdir(tempDir());
    const source = tempDir();
    const runtime = tempDir();
    const cap = captureIO();

    const code = await runCli(
      ["overseer", "runtime-check", "--source", source, "--path", runtime, "--json"],
      cap.io,
    );

    expect(code).toBe(0);
    const data = JSON.parse(cap.stdout) as Record<string, unknown>;
    expect(data.decision).toBe("allow");
    expect(data.sourceRepo).toBe(source);
    expect(data.runtimePath).toBe(runtime);
    expect(data.runtimeWorkspaceSwitchingActive).toBe(false);
    expect(data.wroteFiles).toBe(false);
    expect(data.createdDirectories).toBe(false);
  });

  it("does not create runtime or overseer state directories", async () => {
    const cwd = tempDir();
    chdir(cwd);
    const source = tempDir();
    const runtime = join(tempDir(), "missing-runtime");
    const cap = captureIO();

    const code = await runCli(
      ["overseer", "runtime-check", "--source", source, "--path", runtime],
      cap.io,
    );

    expect(code).toBe(0);
    expect(existsSync(runtime)).toBe(false);
    expect(existsSync(join(cwd, ".relayos", "overseer"))).toBe(false);
  });
});

describe("relayos overseer brief", () => {
  it("exits 0 and prints header with no overseer state", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "brief"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("RELAYOS OVERSEER BRIEF");
    expect(cap.stdout).toContain("missing");
    expect(cap.stderr).toBe("");
  });

  it("shows next action when set", async () => {
    chdir(tempDir());
    await runCli(["overseer", "next", "ship the patch"], captureIO().io);

    const cap = captureIO();
    const code = await runCli(["overseer", "brief"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("NEXT ACTION");
    expect(cap.stdout).toContain("ship the patch");
  });

  it("includes local data safety warning", async () => {
    chdir(tempDir());
    const cap = captureIO();

    await runCli(["overseer", "brief"], cap.io);

    expect(cap.stdout).toContain("LOCAL DATA SAFETY");
    expect(cap.stdout).toContain("gitignored");
  });

  it("prints stable JSON with null/empty values when overseer state is missing", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "brief", "--json"], cap.io);

    expect(code).toBe(0);
    const data = JSON.parse(cap.stdout) as Record<string, unknown>;
    expect(data.project).toBeNull();
    expect(data.currentState).toBeNull();
    expect(data.releasePolicy).toBeNull();
    expect(data.forbiddenActions).toBeNull();
    expect(data.productDirection).toBeNull();
    expect(data.nextAction).toBeNull();
    expect(data.activeBranch).toBeNull();
    expect(data.latestCommit === null || typeof data.latestCommit === "string").toBe(true);
    expect(Array.isArray(data.branchProgress)).toBe(true);
    expect((data.branchProgress as unknown[]).length).toBe(0);
    expect(Array.isArray(data.notes)).toBe(true);
    expect(cap.stderr).toBe("");
  });

  it("prints stable JSON with populated values", async () => {
    chdir(tempDir());
    await runCli(["overseer", "next", "ship the patch"], captureIO().io);
    await runCli(["overseer", "branch", "my-feature"], captureIO().io);
    await runCli(["overseer", "progress", "first entry"], captureIO().io);
    const cap = captureIO();

    const code = await runCli(["overseer", "brief", "--json"], cap.io);

    expect(code).toBe(0);
    const data = JSON.parse(cap.stdout) as Record<string, unknown>;
    expect(data.nextAction).toBe("ship the patch");
    expect(data.activeBranch).toBe("my-feature");
    expect(Array.isArray(data.branchProgress)).toBe(true);
    expect((data.branchProgress as string[]).some((line) => line.includes("first entry"))).toBe(true);
    expect(Array.isArray(data.notes)).toBe(true);
    expect(cap.stderr).toBe("");
  });

  it("exits 1 with usage on unsupported flag", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "brief", "--yaml"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("usage: relayos overseer brief");
  });

  it("includes ACTIVE BRANCH section when branch is set", async () => {
    chdir(tempDir());
    await runCli(["overseer", "branch", "my-feature"], captureIO().io);

    const cap = captureIO();
    const code = await runCli(["overseer", "brief"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("ACTIVE BRANCH");
    expect(cap.stdout).toContain("my-feature");
  });

  it("includes BRANCH PROGRESS section when progress entries exist", async () => {
    chdir(tempDir());
    await runCli(["overseer", "branch", "my-feature"], captureIO().io);
    await runCli(["overseer", "progress", "first entry"], captureIO().io);

    const cap = captureIO();
    await runCli(["overseer", "brief"], cap.io);

    expect(cap.stdout).toContain("BRANCH PROGRESS");
    expect(cap.stdout).toContain("first entry");
  });

  it("omits ACTIVE BRANCH section when no branch is set", async () => {
    chdir(tempDir());
    const cap = captureIO();

    await runCli(["overseer", "brief"], cap.io);

    expect(cap.stdout).not.toContain("ACTIVE BRANCH");
  });
});

describe("relayos overseer init-context", () => {
  it("creates all stub files and reports each one", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "init-context"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("created: .relayos/overseer/project_brief.md");
    expect(cap.stdout).toContain("created: .relayos/overseer/current.md");
    expect(cap.stdout).toContain("created: .relayos/overseer/branches/active/brief.md");
    expect(cap.stdout).toContain("created: .relayos/overseer/planned/enterprise_server.md");
  });

  it("does not overwrite existing files", async () => {
    chdir(tempDir());
    await runCli(["overseer", "init-context"], captureIO().io);
    await runCli(["overseer", "next", "preserve me"], captureIO().io);

    const cap = captureIO();
    await runCli(["overseer", "init-context"], cap.io);

    expect(cap.stdout).toContain("already complete");
    // next_action.md is not a context init file — unrelated; just verify no crash
  });

  it("reports already complete when run twice", async () => {
    chdir(tempDir());
    await runCli(["overseer", "init-context"], captureIO().io);

    const cap = captureIO();
    const code = await runCli(["overseer", "init-context"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("already complete");
  });
});

describe("relayos overseer branch", () => {
  it("sets the active branch name and confirms", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "branch", "my-task"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("active branch set: my-task");
  });

  it("overwrites previous branch name", async () => {
    chdir(tempDir());
    await runCli(["overseer", "branch", "old-task"], captureIO().io);

    const cap = captureIO();
    await runCli(["overseer", "branch", "new-task"], cap.io);

    expect(cap.stdout).toContain("new-task");
  });

  it("exits 1 with usage when no name is given", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "branch"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("usage: relayos overseer branch <name>");
  });
});

describe("relayos overseer progress", () => {
  it("records a progress entry and confirms", async () => {
    chdir(tempDir());
    await runCli(["overseer", "branch", "my-task"], captureIO().io);
    const cap = captureIO();

    const code = await runCli(["overseer", "progress", "tests passing"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("progress recorded: tests passing");
  });

  it("prints current progress without args", async () => {
    chdir(tempDir());
    await runCli(["overseer", "branch", "my-task"], captureIO().io);
    await runCli(["overseer", "progress", "step one done"], captureIO().io);

    const cap = captureIO();
    const code = await runCli(["overseer", "progress"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("step one done");
  });

  it("appends multiple entries in order", async () => {
    chdir(tempDir());
    await runCli(["overseer", "branch", "my-task"], captureIO().io);
    await runCli(["overseer", "progress", "entry one"], captureIO().io);
    await runCli(["overseer", "progress", "entry two"], captureIO().io);

    const cap = captureIO();
    await runCli(["overseer", "progress"], cap.io);

    const out = cap.stdout;
    expect(out.indexOf("entry one")).toBeLessThan(out.indexOf("entry two"));
  });

  it("prints no-data message when no progress has been recorded", async () => {
    chdir(tempDir());
    const cap = captureIO();

    const code = await runCli(["overseer", "progress"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("no branch progress recorded");
  });
});
