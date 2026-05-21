/**
 * Tests for the Run Ledger MCP tools (Plan Task 6):
 *   • write_run_event
 *   • read_current_run
 *   • read_current_task_ledger
 *   • update_task_ledger
 *
 * Each test uses a temp project root and exercises the tool functions
 * directly (the MCP server wrapper is exercised separately via the
 * registerTool integration; this file pins the behavior of the tool
 * implementations).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeRunEvent } from "../src/tools/write_run_event.js";
import { readCurrentRun } from "../src/tools/read_current_run.js";
import { readCurrentTaskLedger } from "../src/tools/read_current_task_ledger.js";
import { updateTaskLedger } from "../src/tools/update_task_ledger.js";
import { registerExecutionWorkspace } from "../src/tools/register_execution_workspace.js";
import { readExecutionWorkspacesTool } from "../src/tools/read_execution_workspaces.js";
import {
  clearActiveRunId,
  setActiveRunId,
  writeRunRecord,
} from "../src/run_ledger.js";
import type { RunRecord } from "../src/schema.js";

let cwd: string;

const RUN_ID = "r_01HXABCDEFGHJKMNPQRSTVWXYZ";

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "run-ledger-mcp-"));
  const run: RunRecord = {
    id: RUN_ID,
    status: "active",
    started_at: new Date().toISOString(),
    task_count: 0,
    handoff_ids: [],
  };
  await writeRunRecord(cwd, run);
  await setActiveRunId(cwd, RUN_ID);
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

// ── write_run_event ─────────────────────────────────────────────────

describe("write_run_event", () => {
  it("appends a task ledger entry and returns ok with run_id+seq+path", async () => {
    const result = await writeRunEvent(
      { seq: 1, user_input: "add util fn", status: "pending" },
      cwd,
    );
    expect(result.ok).toBe(true);
    expect(result.run_id).toBe(RUN_ID);
    expect(result.seq).toBe(1);
    expect(result.path).toContain(RUN_ID);
    expect(result.path).toMatch(/task_ledger\.jsonl$/);
  });

  it("errors when no active run", async () => {
    await clearActiveRunId(cwd);
    await expect(
      writeRunEvent({ seq: 1, user_input: "x", status: "pending" }, cwd),
    ).rejects.toThrow(/no active run/i);
  });

  it("rejects invalid status", async () => {
    await expect(
      writeRunEvent({ seq: 1, user_input: "x", status: "in-progress" }, cwd),
    ).rejects.toThrow();
  });

  it("rejects result_summary > 200 chars", async () => {
    await expect(
      writeRunEvent(
        {
          seq: 1,
          user_input: "x",
          status: "completed",
          result_summary: "x".repeat(201),
        },
        cwd,
      ),
    ).rejects.toThrow();
  });
});

// ── read_current_run ────────────────────────────────────────────────

describe("read_current_run", () => {
  it("returns run + empty recent_tasks + null continuation", async () => {
    const result = await readCurrentRun({}, cwd);
    expect(result.run.id).toBe(RUN_ID);
    expect(result.recent_tasks).toEqual([]);
    expect(result.continuation).toBeNull();
  });

  it("returns recent_tasks after write_run_event", async () => {
    await writeRunEvent({ seq: 1, user_input: "first", status: "pending" }, cwd);
    await writeRunEvent({ seq: 2, user_input: "second", status: "pending" }, cwd);
    const result = await readCurrentRun({}, cwd);
    expect(result.recent_tasks).toHaveLength(2);
    expect(result.recent_tasks.map((t) => t.seq)).toEqual([1, 2]);
  });

  it("errors when no active run", async () => {
    await clearActiveRunId(cwd);
    await expect(readCurrentRun({}, cwd)).rejects.toThrow(/no active run/i);
  });
});

// ── read_current_task_ledger ────────────────────────────────────────

describe("read_current_task_ledger", () => {
  it("returns empty entries + ledger path before any events", async () => {
    const result = await readCurrentTaskLedger({ last_n: 10 }, cwd);
    expect(result.entries).toEqual([]);
    expect(result.run_id).toBe(RUN_ID);
    expect(result.ledger_path).toMatch(/task_ledger\.jsonl$/);
  });

  it("respects last_n bound", async () => {
    for (let i = 1; i <= 5; i++) {
      await writeRunEvent(
        { seq: i, user_input: `t${i}`, status: "pending" },
        cwd,
      );
    }
    const result = await readCurrentTaskLedger({ last_n: 2 }, cwd);
    expect(result.entries.map((e) => e.seq)).toEqual([4, 5]);
  });

  it("default last_n is 20", async () => {
    for (let i = 1; i <= 25; i++) {
      await writeRunEvent(
        { seq: i, user_input: `t${i}`, status: "pending" },
        cwd,
      );
    }
    const result = await readCurrentTaskLedger({}, cwd);
    expect(result.entries).toHaveLength(20);
  });
});

// ── update_task_ledger ──────────────────────────────────────────────

describe("update_task_ledger", () => {
  it("appends an update record; readers see the latest status", async () => {
    await writeRunEvent({ seq: 1, user_input: "x", status: "pending" }, cwd);
    const update = await updateTaskLedger(
      { seq: 1, status: "completed" },
      cwd,
    );
    expect(update.ok).toBe(true);
    const ledger = await readCurrentTaskLedger({ last_n: 10 }, cwd);
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]!.status).toBe("completed");
    expect(ledger.entries[0]!.user_input).toBe("x");
  });

  it("can attach a handoff_id to an existing entry", async () => {
    await writeRunEvent({ seq: 1, user_input: "x", status: "dispatched" }, cwd);
    await updateTaskLedger(
      { seq: 1, handoff_id: "h_01HXYZ", result_summary: "done" },
      cwd,
    );
    const ledger = await readCurrentTaskLedger({ last_n: 10 }, cwd);
    expect(ledger.entries[0]!.handoff_id).toBe("h_01HXYZ");
    expect(ledger.entries[0]!.result_summary).toBe("done");
  });

  it("errors when seq does not exist", async () => {
    await expect(
      updateTaskLedger({ seq: 99, status: "completed" }, cwd),
    ).rejects.toThrow(/No task with seq 99/);
  });

  it("errors when no active run", async () => {
    await clearActiveRunId(cwd);
    await expect(
      updateTaskLedger({ seq: 1, status: "completed" }, cwd),
    ).rejects.toThrow(/no active run/i);
  });
});

// ── Task 9 — register_execution_workspace ───────────────────────────

describe("register_execution_workspace", () => {
  it("registers a workspace and returns ok + workspace_id + path", async () => {
    const result = await registerExecutionWorkspace(
      {
        kind: "git_worktree",
        path: "/tmp/x",
        owner_agent: "codex",
      },
      cwd,
    );
    expect(result.ok).toBe(true);
    expect(result.workspace_id).toMatch(/^w_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(result.run_id).toBe(RUN_ID);
    expect(result.path).toBe("/tmp/x");
  });

  it("defaults cleanup_policy to manual", async () => {
    await registerExecutionWorkspace(
      { kind: "main_checkout", path: "/tmp/y", owner_agent: "human" },
      cwd,
    );
    const listed = await readExecutionWorkspacesTool({}, cwd);
    expect(listed.workspaces[0]!.cleanup_policy).toBe("manual");
  });

  it("preserves optional fields (branch, base_sha, purpose, handoff)", async () => {
    await registerExecutionWorkspace(
      {
        kind: "git_worktree",
        path: "/tmp/z",
        owner_agent: "codex",
        branch: "feat/x",
        base_sha: "abcdef1",
        purpose: "task 3",
        cleanup_policy: "auto_on_merge",
        related_handoff_id: "h_01HXYZ",
      },
      cwd,
    );
    const listed = await readExecutionWorkspacesTool({}, cwd);
    const w = listed.workspaces[0]!;
    expect(w.branch).toBe("feat/x");
    expect(w.base_sha).toBe("abcdef1");
    expect(w.purpose).toBe("task 3");
    expect(w.cleanup_policy).toBe("auto_on_merge");
    expect(w.related_handoff_id).toBe("h_01HXYZ");
  });

  it("errors when no active run", async () => {
    await clearActiveRunId(cwd);
    await expect(
      registerExecutionWorkspace(
        { kind: "git_worktree", path: "/tmp/x", owner_agent: "codex" },
        cwd,
      ),
    ).rejects.toThrow(/no active run/i);
  });

  it("rejects unknown kind", async () => {
    await expect(
      registerExecutionWorkspace(
        { kind: "tarball" as never, path: "/tmp/x", owner_agent: "codex" },
        cwd,
      ),
    ).rejects.toThrow();
  });
});

// ── Task 9 — read_execution_workspaces ──────────────────────────────

describe("read_execution_workspaces", () => {
  it("returns [] when no workspaces registered", async () => {
    const result = await readExecutionWorkspacesTool({}, cwd);
    expect(result.run_id).toBe(RUN_ID);
    expect(result.workspaces).toEqual([]);
  });

  it("returns all workspaces deduped (no filter)", async () => {
    await registerExecutionWorkspace(
      { kind: "git_worktree", path: "/tmp/a", owner_agent: "codex" },
      cwd,
    );
    await registerExecutionWorkspace(
      { kind: "main_checkout", path: "/tmp/b", owner_agent: "human" },
      cwd,
    );
    const result = await readExecutionWorkspacesTool({}, cwd);
    expect(result.workspaces).toHaveLength(2);
    expect(result.workspaces.map((w) => w.path).sort()).toEqual([
      "/tmp/a",
      "/tmp/b",
    ]);
  });

  it("filters by status when provided", async () => {
    await registerExecutionWorkspace(
      { kind: "git_worktree", path: "/tmp/a", owner_agent: "codex" },
      cwd,
    );
    const onlyActive = await readExecutionWorkspacesTool(
      { status: "active" },
      cwd,
    );
    expect(onlyActive.workspaces).toHaveLength(1);
    const onlyMerged = await readExecutionWorkspacesTool(
      { status: "merged" },
      cwd,
    );
    expect(onlyMerged.workspaces).toEqual([]);
  });

  it("accepts an explicit run_id (does not require active run)", async () => {
    await registerExecutionWorkspace(
      { kind: "git_worktree", path: "/tmp/a", owner_agent: "codex" },
      cwd,
    );
    await clearActiveRunId(cwd);
    const result = await readExecutionWorkspacesTool(
      { run_id: RUN_ID },
      cwd,
    );
    expect(result.workspaces).toHaveLength(1);
  });

  it("errors when no run_id given and no active run", async () => {
    await clearActiveRunId(cwd);
    await expect(readExecutionWorkspacesTool({}, cwd)).rejects.toThrow(
      /no active run/i,
    );
  });
});
