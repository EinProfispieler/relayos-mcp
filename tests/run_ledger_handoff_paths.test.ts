import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chdir, cwd } from "node:process";
import { join } from "node:path";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";

const { detectCliMock, runTargetMock } = vi.hoisted(() => ({
  detectCliMock: vi.fn(),
  runTargetMock: vi.fn(),
}));

vi.mock("../src/spawn/index.js", () => ({
  detectCli: detectCliMock,
  runTarget: runTargetMock,
}));

import { runCli } from "../src/cli.js";
import { createHandoff } from "../src/tools/create_handoff.js";
import { createAuditWriter } from "../src/audit.js";
import { resolveStorageLayout } from "../src/storage.js";
import { sampleInput } from "./_helpers.js";
import { setActiveRunId, writeRunRecord } from "../src/run_ledger.js";
import type { RunRecord } from "../src/schema.js";

let prevCwd = "";
let prevHandoffDir: string | undefined;
let projectRoot = "";
let handoffRoot = "";

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

function writePlan(planId: string): void {
  const plansDir = join(projectRoot, ".relayos", "overseer", "plans");
  mkdirSync(plansDir, { recursive: true });
  const plan = {
    plan_id: planId,
    created_at: new Date().toISOString(),
    goal: "validate run-ledger handoff auto-record parity",
    questions: [],
    answers: [],
    tasks: [
      {
        id: "t1",
        title: "implement feature",
        target: "codex",
        model: "gpt-5.5",
        effort: "medium",
        mode: "patch",
        description: "do the thing",
        depends_on: [],
        status: "pending",
        retry_count: 0,
      },
    ],
    reporting: "",
    status: "ready",
  };
  writeFileSync(join(plansDir, `${planId}.json`), JSON.stringify(plan, null, 2), "utf8");
}

async function startActiveRun(runId = "r_01HXABCDEFGHJKMNPQRSTVWXYZ"): Promise<string> {
  const run: RunRecord = {
    id: runId,
    status: "active",
    started_at: new Date().toISOString(),
    task_count: 0,
    handoff_ids: [],
  };
  await writeRunRecord(projectRoot, run);
  await setActiveRunId(projectRoot, runId);
  return runId;
}

function readSourceIndex(runId: string): Array<Record<string, unknown>> {
  const path = join(
    projectRoot,
    ".relayos",
    "overseer",
    "runs",
    runId,
    "source_index.jsonl",
  );
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function readWorkspaces(runId: string): Array<Record<string, unknown>> {
  const path = join(projectRoot, ".relayos", "overseer", "runs", runId, "WORKSPACES.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

beforeEach(() => {
  prevCwd = cwd();
  prevHandoffDir = process.env.HANDOFF_DIR;
  projectRoot = mkdtempSync(join(tmpdir(), "relayos-run-ledger-paths-project-"));
  handoffRoot = mkdtempSync(join(tmpdir(), "relayos-run-ledger-paths-handoff-"));
  mkdirSync(join(handoffRoot, "envelopes"), { recursive: true });
  process.env.HANDOFF_DIR = handoffRoot;
  delete process.env.RELAYOS_RUN_LEDGER_AUTO_RECORD;
  chdir(projectRoot);

  detectCliMock.mockReset();
  runTargetMock.mockReset();
  detectCliMock.mockResolvedValue({
    target_binary: "codex",
    found: true,
    resolved_path: "/usr/local/bin/codex",
  });
  runTargetMock.mockResolvedValue({
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    exit_code: 0,
    duration_ms: 5,
    stdout_tail: "ok",
    stderr_tail: "",
  });
});

afterEach(() => {
  chdir(prevCwd);
  if (prevHandoffDir === undefined) delete process.env.HANDOFF_DIR;
  else process.env.HANDOFF_DIR = prevHandoffDir;
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(handoffRoot, { recursive: true, force: true });
});

describe("run-ledger auto-record parity across remaining handoff execution paths", () => {
  it("plan-execute-task auto-records workspace when env opt-in is enabled", async () => {
    const runId = await startActiveRun();
    writePlan("plan_P2");
    process.env.RELAYOS_RUN_LEDGER_AUTO_RECORD = "1";

    const cap = captureIO();
    const code = await runCli(["overseer", "plan-execute-task", "plan_P2", "t1"], cap.io);
    expect(code).toBe(0);

    const workspaces = readWorkspaces(runId);
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]?.kind).toBe("main_checkout");
    expect(workspaces[0]?.status).toBe("merged");

    // plan-task handoffs currently use allowed_files=[], so only workspace is recorded.
    expect(readSourceIndex(runId)).toEqual([]);
    expect(cap.stdout).toContain("[run-ledger] workspace recorded:");
  });

  it("MCP create_handoff(auto_spawn) stays default-OFF without opt-in", async () => {
    const runId = await startActiveRun();
    const layout = resolveStorageLayout();
    const audit = createAuditWriter(layout);

    const result = await createHandoff(
      sampleInput({
        auto_spawn: true,
        allowed_files: ["src/a.ts"],
        working_dir: projectRoot,
      }),
      { layout, audit },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");
    expect(readSourceIndex(runId)).toEqual([]);
    expect(readWorkspaces(runId)).toEqual([]);
  });

  it("MCP create_handoff(auto_spawn) records source/workspace with record_run_ledger=true", async () => {
    const runId = await startActiveRun();
    const layout = resolveStorageLayout();
    const audit = createAuditWriter(layout);

    const result = await createHandoff(
      sampleInput({
        auto_spawn: true,
        record_run_ledger: true,
        allowed_files: ["src/a.ts", "src/b.ts"],
        working_dir: projectRoot,
      }),
      { layout, audit },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");

    const index = readSourceIndex(runId);
    expect(index).toHaveLength(2);
    expect(index.map((r) => r.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(index.every((r) => r.handoff_id === result.handoff_id)).toBe(true);

    const workspaces = readWorkspaces(runId);
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]?.related_handoff_id).toBe(result.handoff_id);
    expect(workspaces[0]?.owner_agent).toBe("codex");
    expect(workspaces[0]?.status).toBe("merged");
  });

  it("MCP auto-record follows working_dir as the ledger root (not process cwd)", async () => {
    const otherProject = mkdtempSync(join(tmpdir(), "relayos-run-ledger-paths-other-project-"));
    try {
      const otherRunId = "r_01KS6728GVG9ZF5Z917SMPFTZZ";
      const run: RunRecord = {
        id: otherRunId,
        status: "active",
        started_at: new Date().toISOString(),
        task_count: 0,
        handoff_ids: [],
      };
      await writeRunRecord(otherProject, run);
      await setActiveRunId(otherProject, otherRunId);

      const layout = resolveStorageLayout();
      const audit = createAuditWriter(layout);
      const result = await createHandoff(
        sampleInput({
          auto_spawn: true,
          record_run_ledger: true,
          allowed_files: ["src/only-other.ts"],
          working_dir: otherProject,
        }),
        { layout, audit },
      );
      expect(result.error).toBeUndefined();

      // Must write into `otherProject` run ledger, not the test process cwd project.
      const otherIndexPath = join(
        otherProject,
        ".relayos",
        "overseer",
        "runs",
        otherRunId,
        "source_index.jsonl",
      );
      expect(existsSync(otherIndexPath)).toBe(true);
      const otherRows = readFileSync(otherIndexPath, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>);
      expect(otherRows).toHaveLength(1);
      expect(otherRows[0]?.path).toBe("src/only-other.ts");

      // Current cwd project run should remain untouched.
      const cwdRunId = "r_01HXABCDEFGHJKMNPQRSTVWXYZ";
      expect(readSourceIndex(cwdRunId)).toEqual([]);
      expect(readWorkspaces(cwdRunId)).toEqual([]);
    } finally {
      rmSync(otherProject, { recursive: true, force: true });
    }
  });
});
