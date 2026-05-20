import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendExecutionWorkspace,
  appendSourceIndexEntry,
  appendTaskLedgerEntry,
  clearActiveRunId,
  listRuns,
  readActiveRunId,
  readContinuationPacket,
  readExecutionWorkspaces,
  readRunRecord,
  readSourceIndexEntries,
  readTaskLedgerEntries,
  resolveActiveRunPath,
  resolveRunLayout,
  resolveRunsDir,
  setActiveRunId,
  updateExecutionWorkspaceStatus,
  writeContinuationPacket,
  writeRunRecord,
} from "../src/run_ledger.js";
import type {
  ContinuationPacket,
  ExecutionWorkspace,
  RunRecord,
  SourceIndexEntry,
  TaskLedgerEntry,
} from "../src/schema.js";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "run-ledger-"));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

function isoNow(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "r_01HXABCDEFGHJKMNPQRSTVWXYZ",
    status: "active",
    started_at: isoNow(),
    task_count: 0,
    handoff_ids: [],
    ...overrides,
  };
}

// ── Path resolution ──────────────────────────────────────────────────

describe("path resolution", () => {
  it("resolveRunsDir returns .relayos/overseer/runs/", () => {
    expect(resolveRunsDir(cwd)).toBe(join(cwd, ".relayos", "overseer", "runs"));
  });

  it("resolveActiveRunPath returns .relayos/overseer/active_run.json", () => {
    expect(resolveActiveRunPath(cwd)).toBe(
      join(cwd, ".relayos", "overseer", "active_run.json"),
    );
  });

  it("resolveRunLayout exposes all expected files including WORKSPACES.jsonl", () => {
    const layout = resolveRunLayout(cwd, "r_01TEST");
    expect(layout.runDir).toContain(join("runs", "r_01TEST"));
    expect(layout.runJson).toMatch(/run\.json$/);
    expect(layout.taskLedger).toMatch(/task_ledger\.jsonl$/);
    expect(layout.continuation).toMatch(/continuation\.json$/);
    expect(layout.sourceIndex).toMatch(/source_index\.jsonl$/);
    expect(layout.workspaces).toMatch(/WORKSPACES\.jsonl$/);
  });
});

// ── Active-run pointer ───────────────────────────────────────────────

describe("active run pointer", () => {
  it("readActiveRunId returns null when no pointer exists", async () => {
    expect(await readActiveRunId(cwd)).toBeNull();
  });

  it("round-trips set → read → clear", async () => {
    await setActiveRunId(cwd, "r_01HXABCDEFGHJKMNPQRSTVWXYZ");
    expect(await readActiveRunId(cwd)).toBe("r_01HXABCDEFGHJKMNPQRSTVWXYZ");
    await clearActiveRunId(cwd);
    expect(await readActiveRunId(cwd)).toBeNull();
  });

  it("clearActiveRunId is a no-op when nothing is set", async () => {
    await expect(clearActiveRunId(cwd)).resolves.toBeUndefined();
  });

  it("setActiveRunId overwrites a prior pointer", async () => {
    await setActiveRunId(cwd, "r_01AAAAAAAAAAAAAAAAAAAAAAAA");
    await setActiveRunId(cwd, "r_01BBBBBBBBBBBBBBBBBBBBBBBB");
    expect(await readActiveRunId(cwd)).toBe("r_01BBBBBBBBBBBBBBBBBBBBBBBB");
  });

  it("readActiveRunId returns null for malformed pointer file", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(join(cwd, ".relayos", "overseer"), { recursive: true });
    await writeFile(resolveActiveRunPath(cwd), "not json{{");
    expect(await readActiveRunId(cwd)).toBeNull();
  });
});

// ── RunRecord ────────────────────────────────────────────────────────

describe("RunRecord", () => {
  it("readRunRecord returns null when nothing has been written", async () => {
    expect(await readRunRecord(cwd, "r_NEVER")).toBeNull();
  });

  it("round-trips a RunRecord", async () => {
    const run = makeRun({ goal: "test", task_count: 3, handoff_ids: ["h_1"] });
    await writeRunRecord(cwd, run);
    const read = await readRunRecord(cwd, run.id);
    expect(read).toEqual(run);
  });

  it("writeRunRecord rejects invalid records (no r_ prefix)", async () => {
    await expect(
      writeRunRecord(cwd, makeRun({ id: "not_a_run_id" })),
    ).rejects.toThrow();
  });

  it("listRuns returns [] for empty repo", async () => {
    expect(await listRuns(cwd)).toEqual([]);
  });

  it("listRuns returns multiple runs sorted by started_at desc", async () => {
    const older = makeRun({
      id: "r_01OLDOLDOLDOLDOLDOLDOLDOLD",
      started_at: "2026-05-01T00:00:00Z",
    });
    const newer = makeRun({
      id: "r_01NEWNEWNEWNEWNEWNEWNEWNEW",
      started_at: "2026-05-20T00:00:00Z",
    });
    await writeRunRecord(cwd, older);
    await writeRunRecord(cwd, newer);
    const all = await listRuns(cwd);
    expect(all.map((r) => r.id)).toEqual([newer.id, older.id]);
  });
});

// ── TaskLedger ───────────────────────────────────────────────────────

describe("task ledger", () => {
  const runId = "r_01HXABCDEFGHJKMNPQRSTVWXYZ";

  function makeEntry(overrides: Partial<TaskLedgerEntry> = {}): TaskLedgerEntry {
    const now = isoNow();
    return {
      seq: 1,
      task_id: "t_1",
      run_id: runId,
      user_input: "do something",
      status: "pending",
      created_at: now,
      updated_at: now,
      ...overrides,
    };
  }

  it("readTaskLedgerEntries returns [] for missing ledger", async () => {
    expect(await readTaskLedgerEntries(cwd, runId, 10)).toEqual([]);
  });

  it("appends and reads back a single entry", async () => {
    await appendTaskLedgerEntry(cwd, runId, makeEntry());
    const all = await readTaskLedgerEntries(cwd, runId, 10);
    expect(all).toHaveLength(1);
    expect(all[0]!.seq).toBe(1);
  });

  it("dedups by seq with last-write-wins on updated_at", async () => {
    const earlier = makeEntry({
      status: "pending",
      updated_at: "2026-05-20T10:00:00Z",
    });
    const later = makeEntry({
      status: "completed",
      updated_at: "2026-05-20T11:00:00Z",
    });
    await appendTaskLedgerEntry(cwd, runId, earlier);
    await appendTaskLedgerEntry(cwd, runId, later);
    const all = await readTaskLedgerEntries(cwd, runId, 10);
    expect(all).toHaveLength(1);
    expect(all[0]!.status).toBe("completed");
  });

  it("keeps distinct seq entries independently", async () => {
    await appendTaskLedgerEntry(cwd, runId, makeEntry({ seq: 1, task_id: "t_1" }));
    await appendTaskLedgerEntry(cwd, runId, makeEntry({ seq: 2, task_id: "t_2" }));
    await appendTaskLedgerEntry(cwd, runId, makeEntry({ seq: 3, task_id: "t_3" }));
    const all = await readTaskLedgerEntries(cwd, runId, 10);
    expect(all.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("lastN slices from the end after sort by seq ascending", async () => {
    for (let i = 1; i <= 5; i++) {
      await appendTaskLedgerEntry(
        cwd,
        runId,
        makeEntry({ seq: i, task_id: `t_${i}` }),
      );
    }
    const last2 = await readTaskLedgerEntries(cwd, runId, 2);
    expect(last2.map((e) => e.seq)).toEqual([4, 5]);
  });

  it("tolerates malformed JSONL lines", async () => {
    const { appendFile, mkdir } = await import("node:fs/promises");
    const layout = resolveRunLayout(cwd, runId);
    await mkdir(layout.runDir, { recursive: true });
    await appendFile(layout.taskLedger, "this is not json\n");
    await appendTaskLedgerEntry(cwd, runId, makeEntry({ seq: 7, task_id: "t_7" }));
    const all = await readTaskLedgerEntries(cwd, runId, 10);
    expect(all).toHaveLength(1);
    expect(all[0]!.seq).toBe(7);
  });
});

// ── ContinuationPacket ───────────────────────────────────────────────

describe("continuation packet", () => {
  const runId = "r_01HXABCDEFGHJKMNPQRSTVWXYZ";

  function makePacket(
    overrides: Partial<ContinuationPacket> = {},
  ): ContinuationPacket {
    return {
      run_id: runId,
      generated_at: isoNow(),
      context_summary: "summary",
      completed_task_ids: [],
      pending_task_ids: [],
      open_questions: [],
      next_action: "next",
      files_modified: [],
      token_budget_note: "note",
      ...overrides,
    };
  }

  it("readContinuationPacket returns null when missing", async () => {
    expect(await readContinuationPacket(cwd, runId)).toBeNull();
  });

  it("round-trips a packet", async () => {
    const packet = makePacket({
      context_summary: "Adding hello fn",
      completed_task_ids: ["t_1"],
      pending_task_ids: ["t_2"],
      next_action: "Run tests",
      files_modified: ["src/util.ts"],
    });
    await writeContinuationPacket(cwd, runId, packet);
    const read = await readContinuationPacket(cwd, runId);
    expect(read).toEqual(packet);
  });

  it("overwrites a previous packet (replace-atomically)", async () => {
    await writeContinuationPacket(
      cwd,
      runId,
      makePacket({ context_summary: "v1" }),
    );
    await writeContinuationPacket(
      cwd,
      runId,
      makePacket({ context_summary: "v2" }),
    );
    const read = await readContinuationPacket(cwd, runId);
    expect(read?.context_summary).toBe("v2");
  });
});

// ── SourceIndexEntry ─────────────────────────────────────────────────

describe("source index", () => {
  const runId = "r_01HXABCDEFGHJKMNPQRSTVWXYZ";

  function makeEntry(overrides: Partial<SourceIndexEntry> = {}): SourceIndexEntry {
    return {
      path: "src/util.ts",
      action: "modified",
      ts: isoNow(),
      ...overrides,
    };
  }

  it("returns [] for missing index", async () => {
    expect(await readSourceIndexEntries(cwd, runId)).toEqual([]);
  });

  it("appends and reads multiple entries in append order", async () => {
    await appendSourceIndexEntry(cwd, runId, makeEntry({ path: "src/a.ts" }));
    await appendSourceIndexEntry(cwd, runId, makeEntry({ path: "src/b.ts" }));
    const all = await readSourceIndexEntries(cwd, runId);
    expect(all.map((e) => e.path)).toEqual(["src/a.ts", "src/b.ts"]);
  });
});

// ── ExecutionWorkspace ───────────────────────────────────────────────

describe("execution workspaces", () => {
  const runId = "r_01HXABCDEFGHJKMNPQRSTVWXYZ";

  function makeWs(overrides: Partial<ExecutionWorkspace> = {}): ExecutionWorkspace {
    const now = isoNow();
    return {
      id: "w_01HXABCDEFGHJKMNPQRSTVWXYZ",
      run_id: runId,
      kind: "git_worktree",
      path: "/tmp/wt",
      owner_agent: "codex",
      status: "active",
      created_at: now,
      updated_at: now,
      cleanup_policy: "auto_on_merge",
      ...overrides,
    };
  }

  it("returns [] when no workspaces registered", async () => {
    expect(await readExecutionWorkspaces(cwd, runId)).toEqual([]);
  });

  it("appends and dedups by id with last-write-wins", async () => {
    await appendExecutionWorkspace(
      cwd,
      runId,
      makeWs({ status: "active", updated_at: "2026-05-20T10:00:00Z" }),
    );
    await appendExecutionWorkspace(
      cwd,
      runId,
      makeWs({ status: "merged", updated_at: "2026-05-20T11:00:00Z" }),
    );
    const all = await readExecutionWorkspaces(cwd, runId);
    expect(all).toHaveLength(1);
    expect(all[0]!.status).toBe("merged");
  });

  it("supports multiple workspaces per run", async () => {
    await appendExecutionWorkspace(
      cwd,
      runId,
      makeWs({
        id: "w_01AAAAAAAAAAAAAAAAAAAAAAAA",
        kind: "main_checkout",
        path: "/a",
        owner_agent: "human",
        cleanup_policy: "manual",
        created_at: "2026-05-20T10:00:00Z",
      }),
    );
    await appendExecutionWorkspace(
      cwd,
      runId,
      makeWs({
        id: "w_01BBBBBBBBBBBBBBBBBBBBBBBB",
        kind: "git_worktree",
        path: "/b",
        owner_agent: "codex",
        cleanup_policy: "auto_on_merge",
        created_at: "2026-05-20T11:00:00Z",
      }),
    );
    const all = await readExecutionWorkspaces(cwd, runId);
    expect(all.map((w) => w.id)).toEqual([
      "w_01AAAAAAAAAAAAAAAAAAAAAAAA",
      "w_01BBBBBBBBBBBBBBBBBBBBBBBB",
    ]);
  });

  it("updateExecutionWorkspaceStatus appends a transition", async () => {
    await appendExecutionWorkspace(cwd, runId, makeWs({ status: "active" }));
    const updated = await updateExecutionWorkspaceStatus(
      cwd,
      runId,
      "w_01HXABCDEFGHJKMNPQRSTVWXYZ",
      "abandoned",
    );
    expect(updated.status).toBe("abandoned");
    const all = await readExecutionWorkspaces(cwd, runId);
    expect(all[0]!.status).toBe("abandoned");
  });

  it("updateExecutionWorkspaceStatus throws on unknown id", async () => {
    await expect(
      updateExecutionWorkspaceStatus(cwd, runId, "w_NOTFOUND", "merged"),
    ).rejects.toThrow(/not found/);
  });
});
