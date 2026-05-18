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
