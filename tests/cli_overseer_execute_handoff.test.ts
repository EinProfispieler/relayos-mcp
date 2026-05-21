import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { chdir, cwd } from "node:process";
import { join } from "node:path";
import { tmpdir } from "node:os";

let testRoot = "";
let envelopesDir = "";
let prevCwd = "";

const { detectCliMock, runTargetMock } = vi.hoisted(() => ({
  detectCliMock: vi.fn(),
  runTargetMock: vi.fn(),
}));

vi.mock("../src/spawn/index.js", () => ({
  detectCli: detectCliMock,
  runTarget: runTargetMock,
}));

vi.mock("../src/storage.js", () => ({
  resolveStorageLayout: () => ({
    root: testRoot,
    auditPath: join(testRoot, "audit.jsonl"),
    envelopesDir,
    checkpointsDir: join(testRoot, "checkpoints"),
  }),
  ensureStorage: vi.fn(),
}));

import { runCli } from "../src/cli.js";
import { resolveOverseerLayout } from "../src/overseer.js";

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

function writeEnvelope(id: string, payload: Record<string, unknown>) {
  writeFileSync(join(envelopesDir, `${id}.json`), JSON.stringify(payload, null, 2), "utf8");
}

beforeEach(() => {
  prevCwd = cwd();
  testRoot = mkdtempSync(join(tmpdir(), "relayos-cli-exec-handoff-"));
  envelopesDir = join(testRoot, "envelopes");
  mkdirSync(envelopesDir, { recursive: true });
  chdir(testRoot);
  detectCliMock.mockReset();
  runTargetMock.mockReset();
});

afterEach(() => {
  chdir(prevCwd);
  if (testRoot) rmSync(testRoot, { recursive: true, force: true });
});

describe("relayos overseer execute-handoff", () => {
  it("returns usage when handoff id is missing", async () => {
    const cap = captureIO();
    const code = await runCli(["overseer", "execute-handoff"], cap.io);
    expect(code).toBe(1);
    expect(cap.stderr).toContain("Usage:");
  });

  it("fails when handoff file is not found", async () => {
    const cap = captureIO();
    const code = await runCli(["overseer", "execute-handoff", "h_missing"], cap.io);
    expect(code).toBe(1);
    expect(cap.stderr).toContain("not found");
  });

  it("fails when handoff status is not recorded", async () => {
    writeEnvelope("h_done", {
      id: "h_done",
      status: "completed",
      target_agent: "codex",
      launch_command: "codex exec 'hello'",
      execution_mode: "patch",
    });

    const cap = captureIO();
    const code = await runCli(["overseer", "execute-handoff", "h_done"], cap.io);
    expect(code).toBe(1);
    expect(cap.stderr).toContain("Cannot execute");
  });

  it("prints launch command for dry-run", async () => {
    writeEnvelope("h_dry", {
      id: "h_dry",
      status: "recorded",
      target_agent: "codex",
      launch_command: "codex exec --json 'full prompt'",
      execution_mode: "patch",
    });

    const cap = captureIO();
    const code = await runCli(["overseer", "execute-handoff", "h_dry", "--dry-run"], cap.io);
    expect(code).toBe(0);
    expect(cap.stdout).toContain("[dry-run]");
    expect(cap.stdout).toContain("codex exec --json 'full prompt'");
    expect(detectCliMock).not.toHaveBeenCalled();
    expect(runTargetMock).not.toHaveBeenCalled();
  });

  it("fails when target cli binary cannot be detected", async () => {
    writeEnvelope("h_detect", {
      id: "h_detect",
      status: "recorded",
      target_agent: "codex",
      launch_command: "codex exec 'go'",
      execution_mode: "patch",
    });
    detectCliMock.mockResolvedValue({ target_binary: "codex", found: false });

    const cap = captureIO();
    const code = await runCli(["overseer", "execute-handoff", "h_detect"], cap.io);
    expect(code).toBe(1);
    expect(cap.stderr).toContain("not found");
  });

  it("runs target with resolved binary and spawn option shape", async () => {
    writeEnvelope("h_run", {
      id: "h_run",
      status: "recorded",
      target_agent: "codex",
      launch_command: "codex exec --model gpt-5.3-codex 'full prompt'",
      execution_mode: "patch",
      working_dir: "/tmp/relayos-target",
    });
    detectCliMock.mockResolvedValue({
      target_binary: "codex",
      found: true,
      resolved_path: "/usr/local/bin/codex",
    });
    runTargetMock.mockResolvedValue({
      started_at: "2026-05-15T00:00:00.000Z",
      finished_at: "2026-05-15T00:00:01.000Z",
      exit_code: 0,
      duration_ms: 1000,
      stdout_tail: "done",
      stderr_tail: "",
    });

    const cap = captureIO();
    const code = await runCli(["overseer", "execute-handoff", "h_run"], cap.io);

    expect(code).toBe(0);
    expect(runTargetMock).toHaveBeenCalledWith({
      layout: {
        root: testRoot,
        auditPath: join(testRoot, "audit.jsonl"),
        envelopesDir,
        checkpointsDir: join(testRoot, "checkpoints"),
      },
      handoffId: "h_run",
      binary: "/usr/local/bin/codex",
      argv: ["codex", "exec", "--model", "gpt-5.3-codex", "full prompt"],
      workingDir: "/tmp/relayos-target",
    });
    expect(cap.stdout).toContain("Status:  completed");
  });

  it("fails cleanly when detectCli throws", async () => {
    writeEnvelope("h_detect_throw", {
      id: "h_detect_throw",
      status: "recorded",
      target_agent: "codex",
      launch_command: "codex exec 'go'",
      execution_mode: "patch",
    });
    detectCliMock.mockRejectedValue(new Error("boom"));

    const cap = captureIO();
    const code = await runCli(["overseer", "execute-handoff", "h_detect_throw"], cap.io);
    expect(code).toBe(1);
    expect(cap.stderr).toContain("Failed to execute handoff");
    expect(cap.stderr).toContain("CLI detection error");
    expect(cap.stderr).toContain("boom");
  });

  it("marks handoff failed when runTarget throws", async () => {
    writeEnvelope("h_run_throw", {
      id: "h_run_throw",
      status: "recorded",
      target_agent: "codex",
      launch_command: "codex exec 'go'",
      execution_mode: "patch",
    });
    detectCliMock.mockResolvedValue({
      target_binary: "codex",
      found: true,
      resolved_path: "/usr/local/bin/codex",
    });
    runTargetMock.mockRejectedValue(new Error("spawn failed"));

    const cap = captureIO();
    const code = await runCli(["overseer", "execute-handoff", "h_run_throw"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr).toContain("Failed to execute handoff");
    expect(cap.stderr).toContain("spawn failed");

    const envelope = JSON.parse(
      readFileSync(join(envelopesDir, "h_run_throw.json"), "utf8"),
    ) as { status?: string; spawn?: { exit_code?: number; stderr_tail?: string } };
    expect(envelope.status).toBe("failed");
    expect(envelope.spawn).toBeUndefined();

    const overseerLayout = resolveOverseerLayout(testRoot);
    const results = readFileSync(overseerLayout.handoffResultsPath, "utf8")
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { run_id?: string; status?: string });
    const record = results.find((entry) => entry.run_id === "h_run_throw");
    expect(record).toBeDefined();
    expect(record?.status).toBe("failed");
  });

  it("calls runTarget with correct SpawnOptions shape on success", async () => {
    writeEnvelope("h_ok", {
      id: "h_ok",
      status: "recorded",
      target_agent: "codex",
      launch_command: "codex exec --model gpt-5.3-codex '[HANDOFF h_ok prompt]'",
      execution_mode: "patch",
    });
    detectCliMock.mockResolvedValue({
      target_binary: "codex",
      found: true,
      resolved_path: "/usr/bin/codex",
    });
    runTargetMock.mockResolvedValue({
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      exit_code: 0,
      duration_ms: 50,
      stdout_tail: "ok",
      stderr_tail: "",
    });

    const cap = captureIO();
    const code = await runCli(["overseer", "execute-handoff", "h_ok"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("completed");
    expect(runTargetMock).toHaveBeenCalledOnce();

    const opts = runTargetMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts["handoffId"]).toBe("h_ok");
    expect(opts["binary"]).toBe("/usr/bin/codex");
    expect(Array.isArray(opts["argv"])).toBe(true);
    expect((opts["argv"] as string[]).length).toBeGreaterThan(0);
    expect(opts["layout"]).toBeDefined();
    expect(typeof opts["layout"]).toBe("object");
  });

  it("decodes shell-escaped single quotes in launch command prompt argv", async () => {
    writeEnvelope("h_quote", {
      id: "h_quote",
      status: "recorded",
      target_agent: "codex",
      launch_command: "codex exec 'it'\\''s quoted'",
      execution_mode: "patch",
    });
    detectCliMock.mockResolvedValue({
      target_binary: "codex",
      found: true,
      resolved_path: "/usr/bin/codex",
    });
    runTargetMock.mockResolvedValue({
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      exit_code: 0,
      duration_ms: 50,
      stdout_tail: "ok",
      stderr_tail: "",
    });

    const cap = captureIO();
    const code = await runCli(["overseer", "execute-handoff", "h_quote"], cap.io);

    expect(code).toBe(0);
    expect(runTargetMock).toHaveBeenCalledOnce();
    const opts = runTargetMock.mock.calls[0]![0] as { argv?: string[] };
    expect(opts.argv).toEqual(["codex", "exec", "it's quoted"]);
  });

  it("preserves backslashes inside single-quoted argv segments", async () => {
    writeEnvelope("h_path", {
      id: "h_path",
      status: "recorded",
      target_agent: "codex",
      launch_command: String.raw`codex exec 'C:\Users\randy\tmp'`,
      execution_mode: "patch",
    });
    detectCliMock.mockResolvedValue({
      target_binary: "codex",
      found: true,
      resolved_path: "/usr/bin/codex",
    });
    runTargetMock.mockResolvedValue({
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      exit_code: 0,
      duration_ms: 50,
      stdout_tail: "ok",
      stderr_tail: "",
    });

    const cap = captureIO();
    const code = await runCli(["overseer", "execute-handoff", "h_path"], cap.io);

    expect(code).toBe(0);
    expect(runTargetMock).toHaveBeenCalledOnce();
    const opts = runTargetMock.mock.calls[0]![0] as { argv?: string[] };
    expect(opts.argv).toEqual(["codex", "exec", "C:\\Users\\randy\\tmp"]);
  });

  it("writes handoff results using the actual target agent label", async () => {
    writeEnvelope("h_claude", {
      id: "h_claude",
      status: "recorded",
      target_agent: "claude",
      launch_command: "claude -p 'hi'",
      execution_mode: "patch",
    });
    detectCliMock.mockResolvedValue({
      target_binary: "claude",
      found: true,
      resolved_path: "/usr/bin/claude",
    });
    runTargetMock.mockResolvedValue({
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      exit_code: 0,
      duration_ms: 50,
      stdout_tail: "ok",
      stderr_tail: "",
    });

    const cap = captureIO();
    const code = await runCli(["overseer", "execute-handoff", "h_claude"], cap.io);
    expect(code).toBe(0);

    const overseerLayout = resolveOverseerLayout(testRoot);
    const results = readFileSync(overseerLayout.handoffResultsPath, "utf8")
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map(
        (line) =>
          JSON.parse(line) as {
            run_id?: string;
            summary?: string;
          },
      );
    const record = results.find((entry) => entry.run_id === "h_claude");
    expect(record?.summary).toBe("claude execution completed for handoff h_claude");
  });

  function writeFullEnvelope(id: string, targetAgent: "codex" | "claude") {
    writeEnvelope(id, {
      id,
      created_at: "2026-05-15T00:00:00.000Z",
      updated_at: "2026-05-15T00:00:00.000Z",
      status: "recorded",
      source_agent: "claude",
      target_agent: targetAgent,
      model: "gpt-5.5",
      effort: "medium",
      execution_mode: "patch",
      task_title: "demo task",
      task_description: "do the thing",
      allowed_files: [],
      forbidden_files: [],
      constraints: [],
      expected_output: ["Patch applied"],
      auto_spawn: false,
      launch_command: `${targetAgent} exec 'go'`,
      audit_metadata: {
        tags: [],
        event_count: 0,
        last_event_ts: "2026-05-15T00:00:00.000Z",
        cli_detection: { target_binary: targetAgent, found: true },
        enforcement_notes: [],
      },
    });
  }

  function writeFailoverConfig() {
    mkdirSync(join(testRoot, ".relayos"), { recursive: true });
    writeFileSync(
      join(testRoot, ".relayos", "config.json"),
      JSON.stringify({
        overseer: {
          providers: [
            { id: "p1", name: "codex", kind: "subscription_cli", model: "gpt-5.5" },
            { id: "p2", name: "claude", kind: "subscription_cli", model: "claude-sonnet-4-6" },
          ],
          primary_provider: "p1",
          backup_providers: ["p2"],
        },
      }),
      "utf8",
    );
  }

  it("fails over to a backup provider when the primary CLI is missing", async () => {
    writeFullEnvelope("h_failover", "codex");
    writeFailoverConfig();
    detectCliMock.mockImplementation(async (binary: string) =>
      binary === "claude"
        ? { target_binary: "claude", found: true, resolved_path: "/usr/local/bin/claude" }
        : { target_binary: "codex", found: false },
    );
    runTargetMock.mockResolvedValue({
      started_at: "2026-05-15T00:00:00.000Z",
      finished_at: "2026-05-15T00:00:01.000Z",
      exit_code: 0,
      duration_ms: 1000,
      stdout_tail: "ok",
      stderr_tail: "",
    });

    const cap = captureIO();
    const code = await runCli(["overseer", "execute-handoff", "h_failover"], cap.io);
    expect(code).toBe(0);
    expect(cap.stdout).toContain('failing over to "claude"');
    expect(cap.stdout).toContain("Provider: claude (failed over from codex)");
    expect(runTargetMock).toHaveBeenCalledTimes(1);
  });

  it("fails when the primary and all backup providers are missing", async () => {
    writeFullEnvelope("h_allfail", "codex");
    writeFailoverConfig();
    detectCliMock.mockResolvedValue({ target_binary: "codex", found: false });

    const cap = captureIO();
    const code = await runCli(["overseer", "execute-handoff", "h_allfail"], cap.io);
    expect(code).toBe(1);
    expect(cap.stderr).toContain("Failed to execute handoff");
    expect(cap.stderr).toContain("codex: CLI binary not found");
    expect(cap.stderr).toContain("claude: CLI binary not found");
    expect(runTargetMock).not.toHaveBeenCalled();
  });
});

// ── P2-T2: Run Ledger auto-record (opt-in only, default OFF) ─────────
//
// Default behavior of execute-handoff is unchanged. The auto-record
// path only fires when the caller explicitly opted in via either the
// --record-run-ledger flag OR RELAYOS_RUN_LEDGER_AUTO_RECORD=1.
// No-op silently when no active run; never fails the surrounding
// handoff result.

describe("relayos overseer execute-handoff — P2-T2 Run Ledger auto-record (opt-in)", () => {
  function writeRecordedEnvelope(id: string, allowed: string[]) {
    writeEnvelope(id, {
      id,
      status: "recorded",
      target_agent: "codex",
      working_dir: testRoot,
      allowed_files: allowed,
      launch_command: "codex exec --json 'do thing'",
      execution_mode: "patch",
    });
  }

  function mockSuccessfulSpawn() {
    detectCliMock.mockResolvedValue({
      target_binary: "codex",
      found: true,
      resolved_path: "/usr/local/bin/codex",
    });
    runTargetMock.mockResolvedValue({
      exit_code: 0,
      duration_ms: 1,
      stdout_path: "/dev/null",
      stderr_path: "/dev/null",
      stdout_tail: "",
      stderr_tail: "",
    });
  }

  async function startActiveRun(): Promise<string> {
    const cap = captureIO();
    const code = await runCli(["overseer", "run", "start"], cap.io);
    expect(code).toBe(0);
    return cap.stdout.trim();
  }

  /** Helper: load and parse a task-scoped JSONL log if it exists. */
  async function readSourceIndex(runId: string): Promise<unknown[]> {
    const path = join(
      testRoot,
      ".relayos",
      "overseer",
      "runs",
      runId,
      "source_index.jsonl",
    );
    const { existsSync, readFileSync } = await import("node:fs");
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  }

  async function readWorkspaces(runId: string): Promise<unknown[]> {
    const path = join(
      testRoot,
      ".relayos",
      "overseer",
      "runs",
      runId,
      "WORKSPACES.jsonl",
    );
    const { existsSync, readFileSync } = await import("node:fs");
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  }

  beforeEach(() => {
    delete process.env.RELAYOS_RUN_LEDGER_AUTO_RECORD;
  });

  // ── Default OFF — existing behavior unchanged ──

  it("default (no flag, no env) makes NO Run Ledger writes after success", async () => {
    const runId = await startActiveRun();
    writeRecordedEnvelope("h_default_off", ["src/a.ts", "src/b.ts"]);
    mockSuccessfulSpawn();

    const cap = captureIO();
    const code = await runCli(["overseer", "execute-handoff", "h_default_off"], cap.io);
    expect(code).toBe(0);
    expect(await readSourceIndex(runId)).toEqual([]);
    expect(await readWorkspaces(runId)).toEqual([]);
    // And no run-ledger noise on stdout
    expect(cap.stdout).not.toContain("[run-ledger]");
  });

  // ── Opt-in via flag ──

  it("--record-run-ledger records SourceIndexEntry per allowed_file", async () => {
    const runId = await startActiveRun();
    writeRecordedEnvelope("h_flag", ["src/a.ts", "src/b.ts", "src/c.ts"]);
    mockSuccessfulSpawn();

    const cap = captureIO();
    const code = await runCli(
      ["overseer", "execute-handoff", "h_flag", "--record-run-ledger"],
      cap.io,
    );
    expect(code).toBe(0);
    expect(cap.stdout).toContain("[run-ledger] source-index: recorded 3 file touches");

    const entries = (await readSourceIndex(runId)) as Array<{
      path: string;
      handoff_id: string;
      action: string;
    }>;
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.path)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(entries.every((e) => e.handoff_id === "h_flag")).toBe(true);
    expect(entries.every((e) => e.action === "modified")).toBe(true);
  });

  it("--record-run-ledger appends one ExecutionWorkspace record per handoff", async () => {
    const runId = await startActiveRun();
    writeRecordedEnvelope("h_flag_ws", ["src/a.ts"]);
    mockSuccessfulSpawn();

    const cap = captureIO();
    const code = await runCli(
      ["overseer", "execute-handoff", "h_flag_ws", "--record-run-ledger"],
      cap.io,
    );
    expect(code).toBe(0);
    expect(cap.stdout).toMatch(/\[run-ledger\] workspace recorded: w_[0-9A-HJKMNP-TV-Z]{26}/);

    const ws = (await readWorkspaces(runId)) as Array<{
      id: string;
      run_id: string;
      kind: string;
      related_handoff_id: string;
      owner_agent: string;
      status: string;
    }>;
    expect(ws).toHaveLength(1);
    expect(ws[0]!.kind).toBe("main_checkout");
    expect(ws[0]!.related_handoff_id).toBe("h_flag_ws");
    expect(ws[0]!.owner_agent).toBe("codex");
    expect(ws[0]!.status).toBe("merged"); // completed → merged
    expect(ws[0]!.run_id).toBe(runId);
  });

  // ── Opt-in via env var ──

  it("RELAYOS_RUN_LEDGER_AUTO_RECORD=1 alone enables auto-record (no flag)", async () => {
    process.env.RELAYOS_RUN_LEDGER_AUTO_RECORD = "1";
    const runId = await startActiveRun();
    writeRecordedEnvelope("h_env", ["src/x.ts"]);
    mockSuccessfulSpawn();

    const cap = captureIO();
    const code = await runCli(["overseer", "execute-handoff", "h_env"], cap.io);
    expect(code).toBe(0);
    expect(cap.stdout).toContain("[run-ledger]");

    const entries = await readSourceIndex(runId);
    expect(entries).toHaveLength(1);
    const ws = await readWorkspaces(runId);
    expect(ws).toHaveLength(1);
  });

  it("RELAYOS_RUN_LEDGER_AUTO_RECORD=0 (or unset) is OFF — default behavior intact", async () => {
    process.env.RELAYOS_RUN_LEDGER_AUTO_RECORD = "0";
    const runId = await startActiveRun();
    writeRecordedEnvelope("h_env_off", ["src/x.ts"]);
    mockSuccessfulSpawn();

    const cap = captureIO();
    const code = await runCli(["overseer", "execute-handoff", "h_env_off"], cap.io);
    expect(code).toBe(0);
    expect(await readSourceIndex(runId)).toEqual([]);
    expect(await readWorkspaces(runId)).toEqual([]);
  });

  // ── No-op behavior when no active run ──

  it("opt-in with no active run is a stderr note, NOT a failure", async () => {
    // No `overseer run start` — there is no active run.
    writeRecordedEnvelope("h_no_run", ["src/a.ts"]);
    mockSuccessfulSpawn();

    const cap = captureIO();
    const code = await runCli(
      ["overseer", "execute-handoff", "h_no_run", "--record-run-ledger"],
      cap.io,
    );
    expect(code).toBe(0); // handoff itself still succeeded
    expect(cap.stderr).toContain("auto-record requested but no active run");
  });

  // ── Workspace status reflects the spawn outcome ──

  it("workspace.status is 'active' when the spawn exit_code != 0", async () => {
    const runId = await startActiveRun();
    writeRecordedEnvelope("h_failed_run", ["src/a.ts"]);
    detectCliMock.mockResolvedValue({
      target_binary: "codex",
      found: true,
      resolved_path: "/usr/local/bin/codex",
    });
    runTargetMock.mockResolvedValue({
      exit_code: 1,
      duration_ms: 1,
      stdout_path: "/dev/null",
      stderr_path: "/dev/null",
      stdout_tail: "",
      stderr_tail: "",
    });

    const cap = captureIO();
    const code = await runCli(
      ["overseer", "execute-handoff", "h_failed_run", "--record-run-ledger"],
      cap.io,
    );
    expect(code).toBe(1);
    const ws = (await readWorkspaces(runId)) as Array<{ status: string }>;
    expect(ws).toHaveLength(1);
    expect(ws[0]!.status).toBe("active"); // not "merged"
  });

  // ── Dry-run never triggers auto-record ──

  it("--dry-run with --record-run-ledger does NOT touch the ledger", async () => {
    const runId = await startActiveRun();
    writeRecordedEnvelope("h_dry", ["src/a.ts"]);

    const cap = captureIO();
    const code = await runCli(
      ["overseer", "execute-handoff", "--dry-run", "h_dry", "--record-run-ledger"],
      cap.io,
    );
    expect(code).toBe(0);
    expect(await readSourceIndex(runId)).toEqual([]);
    expect(await readWorkspaces(runId)).toEqual([]);
    expect(detectCliMock).not.toHaveBeenCalled();
    expect(runTargetMock).not.toHaveBeenCalled();
  });

  // ── Empty allowed_files: workspace still recorded, source-index skipped ──

  it("allowed_files=[] records the workspace but skips source-index", async () => {
    const runId = await startActiveRun();
    writeRecordedEnvelope("h_no_files", []);
    mockSuccessfulSpawn();

    const cap = captureIO();
    const code = await runCli(
      ["overseer", "execute-handoff", "h_no_files", "--record-run-ledger"],
      cap.io,
    );
    expect(code).toBe(0);
    expect(await readSourceIndex(runId)).toEqual([]);
    expect((await readWorkspaces(runId))).toHaveLength(1);
    // No "source-index: recorded N file touches" line
    expect(cap.stdout).not.toContain("[run-ledger] source-index");
  });
});
