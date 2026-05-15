import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let testRoot = "";
let envelopesDir = "";

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
  testRoot = mkdtempSync(join(tmpdir(), "relayos-cli-exec-handoff-"));
  envelopesDir = join(testRoot, "envelopes");
  mkdirSync(envelopesDir, { recursive: true });
  detectCliMock.mockReset();
  runTargetMock.mockReset();
});

afterEach(() => {
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
    await expect(runCli(["overseer", "execute-handoff", "h_detect_throw"], cap.io)).rejects.toThrow(
      "boom",
    );
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
    expect(cap.stdout).toContain("Status:  failed");
    expect(cap.stdout).toContain("Exit code: 1");
    expect(cap.stdout).toContain("spawn failed");

    const envelope = JSON.parse(
      readFileSync(join(envelopesDir, "h_run_throw.json"), "utf8"),
    ) as { status?: string; spawn?: { exit_code?: number; stderr_tail?: string } };
    expect(envelope.status).toBe("failed");
    expect(envelope.spawn?.exit_code).toBe(1);
    expect(envelope.spawn?.stderr_tail).toContain("spawn failed");
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
});
