import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendDraftReply,
  appendExecutionWorkspace,
  appendRepairAttempt,
  appendRepairDecision,
  appendReviewEvent,
  appendReviewFinding,
  appendSourceIndexEntry,
  appendTaskLedgerEntry,
  clearActiveRunId,
  listRuns,
  readActiveRepairDecision,
  readActiveRunId,
  readContinuationPacket,
  readDraftReplies,
  readExecutionWorkspaces,
  readLatestRepairAttempt,
  readRepairAttempts,
  readRepairGuidance,
  readReviewEvents,
  readReviewFindings,
  readRunRecord,
  readSourceIndexEntries,
  readTaskLedgerEntries,
  resolveActiveRunPath,
  resolveRunLayout,
  resolveRunsDir,
  resolveTaskLayout,
  setActiveRunId,
  updateExecutionWorkspaceStatus,
  writeContinuationPacket,
  writeRepairGuidance,
  writeRunRecord,
} from "../src/run_ledger.js";
import type {
  ContinuationPacket,
  DraftReply,
  ExecutionWorkspace,
  RepairAttempt,
  RepairPolicyDecision,
  ReviewFinding,
  ReviewLoopEvent,
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

// ── Task 11 — task-scoped storage helpers (Plan §4) ──────────────────

const RUN_ID = "r_01HXABCDEFGHJKMNPQRSTVWXYZ";
const TASK_ID = "t_1";

function isoAt(year: number, month: number, day: number, hour = 10): string {
  // Returns "YYYY-MM-DDTHH:00:00Z" — predictable, ascii-sortable, no
  // dependency on the current clock. Lets tests assert dedup/order
  // deterministically.
  const m = month.toString().padStart(2, "0");
  const d = day.toString().padStart(2, "0");
  const h = hour.toString().padStart(2, "0");
  return `${year}-${m}-${d}T${h}:00:00Z`;
}

describe("resolveTaskLayout", () => {
  it("returns paths under <runDir>/tasks/<task_id>/", () => {
    const layout = resolveTaskLayout(cwd, RUN_ID, TASK_ID);
    expect(layout.taskDir).toContain(
      join("runs", RUN_ID, "tasks", TASK_ID),
    );
    expect(layout.taskLedgerMd).toMatch(/TASK_LEDGER\.md$/);
    expect(layout.reviewFindings).toMatch(/REVIEW_FINDINGS\.jsonl$/);
    expect(layout.repairAttempts).toMatch(/REPAIR_ATTEMPTS\.jsonl$/);
    expect(layout.repairDecisions).toMatch(/REPAIR_DECISIONS\.jsonl$/);
    expect(layout.draftReplies).toMatch(/DRAFT_REPLIES\.jsonl$/);
    expect(layout.repairGuidance).toMatch(/REPAIR_GUIDANCE\.md$/);
    expect(layout.reviewEvents).toMatch(/REVIEW_EVENTS\.jsonl$/);
  });

  it("different task IDs resolve to different directories", () => {
    const a = resolveTaskLayout(cwd, RUN_ID, "t_a");
    const b = resolveTaskLayout(cwd, RUN_ID, "t_b");
    expect(a.taskDir).not.toBe(b.taskDir);
  });
});

// ── ReviewFinding ─────────────────────────────────────────────────────

describe("review findings", () => {
  function makeFinding(o: Partial<ReviewFinding> = {}): ReviewFinding {
    return {
      id: "f_01HXABCDEFGHJKMNPQRSTVWXYZ",
      run_id: RUN_ID,
      task_id: TASK_ID,
      reviewer: "claude",
      severity: "warn",
      category: "missing_tests",
      title: "Default title",
      summary: "Default summary",
      evidence_refs: [],
      status: "open",
      created_at: isoAt(2026, 5, 21, 10),
      updated_at: isoAt(2026, 5, 21, 10),
      ...o,
    };
  }

  it("readReviewFindings returns [] when nothing has been written", async () => {
    expect(await readReviewFindings(cwd, RUN_ID, TASK_ID)).toEqual([]);
  });

  it("round-trips a single finding", async () => {
    const f = makeFinding({ title: "rt" });
    await appendReviewFinding(cwd, RUN_ID, TASK_ID, f);
    const all = await readReviewFindings(cwd, RUN_ID, TASK_ID);
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe(f.id);
  });

  it("dedups by id with last-write-wins on updated_at", async () => {
    await appendReviewFinding(
      cwd,
      RUN_ID,
      TASK_ID,
      makeFinding({ status: "open", updated_at: isoAt(2026, 5, 21, 10) }),
    );
    await appendReviewFinding(
      cwd,
      RUN_ID,
      TASK_ID,
      makeFinding({ status: "resolved", updated_at: isoAt(2026, 5, 21, 11) }),
    );
    const all = await readReviewFindings(cwd, RUN_ID, TASK_ID);
    expect(all).toHaveLength(1);
    expect(all[0]!.status).toBe("resolved");
  });

  it("keeps distinct ids and sorts by created_at asc", async () => {
    await appendReviewFinding(
      cwd,
      RUN_ID,
      TASK_ID,
      makeFinding({
        id: "f_01AAAAAAAAAAAAAAAAAAAAAAAA",
        created_at: isoAt(2026, 5, 21, 11),
      }),
    );
    await appendReviewFinding(
      cwd,
      RUN_ID,
      TASK_ID,
      makeFinding({
        id: "f_01BBBBBBBBBBBBBBBBBBBBBBBB",
        created_at: isoAt(2026, 5, 21, 10),
      }),
    );
    const all = await readReviewFindings(cwd, RUN_ID, TASK_ID);
    expect(all.map((f) => f.id)).toEqual([
      "f_01BBBBBBBBBBBBBBBBBBBBBBBB",
      "f_01AAAAAAAAAAAAAAAAAAAAAAAA",
    ]);
  });

  it("tolerates malformed JSONL lines", async () => {
    const { appendFile, mkdir } = await import("node:fs/promises");
    const layout = resolveTaskLayout(cwd, RUN_ID, TASK_ID);
    await mkdir(layout.taskDir, { recursive: true });
    await appendFile(layout.reviewFindings, "this is not json\n");
    await appendReviewFinding(cwd, RUN_ID, TASK_ID, makeFinding({ title: "ok" }));
    const all = await readReviewFindings(cwd, RUN_ID, TASK_ID);
    expect(all).toHaveLength(1);
  });
});

// ── RepairAttempt ─────────────────────────────────────────────────────

describe("repair attempts", () => {
  function makeAttempt(o: Partial<RepairAttempt> = {}): RepairAttempt {
    return {
      id: "a_01HXABCDEFGHJKMNPQRSTVWXYZ",
      finding_id: "f_01",
      run_id: RUN_ID,
      task_id: TASK_ID,
      attempt_number: 1,
      provider: "codex",
      model: "gpt-5.3-codex",
      effort: "medium",
      mode: "patch",
      changed_variables_since_previous_attempt: [],
      prompt_summary: "fix the obvious thing",
      required_scope: { allowed_files: ["src/util.ts"], forbidden_files: [] },
      required_tests: ["tests/util.test.ts"],
      reviewer: "claude",
      result: "fixed",
      evidence_refs: [],
      created_at: isoAt(2026, 5, 21, 10),
      ...o,
    };
  }

  it("readRepairAttempts returns [] for empty state", async () => {
    expect(await readRepairAttempts(cwd, RUN_ID, TASK_ID)).toEqual([]);
  });

  it("round-trips a single attempt", async () => {
    const a = makeAttempt();
    await appendRepairAttempt(cwd, RUN_ID, TASK_ID, a);
    const all = await readRepairAttempts(cwd, RUN_ID, TASK_ID);
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe(a.id);
  });

  it("dedups by id with last-write-wins on completed_at ?? created_at", async () => {
    await appendRepairAttempt(
      cwd,
      RUN_ID,
      TASK_ID,
      makeAttempt({
        result: "incomplete",
        created_at: isoAt(2026, 5, 21, 10),
      }),
    );
    await appendRepairAttempt(
      cwd,
      RUN_ID,
      TASK_ID,
      makeAttempt({
        result: "fixed",
        created_at: isoAt(2026, 5, 21, 10),
        completed_at: isoAt(2026, 5, 21, 11),
      }),
    );
    const all = await readRepairAttempts(cwd, RUN_ID, TASK_ID);
    expect(all).toHaveLength(1);
    expect(all[0]!.result).toBe("fixed");
  });

  it("sorts attempts by attempt_number ascending (even when written out of order)", async () => {
    const idForN: Record<number, string> = {
      1: "a_01ONE0000000000000000000ON",
      2: "a_01TWO0000000000000000000TW",
      3: "a_01THREE000000000000000THRE",
    };
    for (const n of [3, 1, 2]) {
      await appendRepairAttempt(
        cwd,
        RUN_ID,
        TASK_ID,
        makeAttempt({ id: idForN[n]!, attempt_number: n }),
      );
    }
    const all = await readRepairAttempts(cwd, RUN_ID, TASK_ID);
    expect(all.map((a) => a.attempt_number)).toEqual([1, 2, 3]);
  });

  it("readLatestRepairAttempt returns null when finding has no attempts", async () => {
    expect(
      await readLatestRepairAttempt(cwd, RUN_ID, TASK_ID, "f_nope"),
    ).toBeNull();
  });

  it("readLatestRepairAttempt returns highest attempt_number for finding", async () => {
    await appendRepairAttempt(
      cwd,
      RUN_ID,
      TASK_ID,
      makeAttempt({
        id: "a_01AAAAAAAAAAAAAAAAAAAAAAAA",
        finding_id: "f_A",
        attempt_number: 1,
      }),
    );
    await appendRepairAttempt(
      cwd,
      RUN_ID,
      TASK_ID,
      makeAttempt({
        id: "a_01BBBBBBBBBBBBBBBBBBBBBBBB",
        finding_id: "f_A",
        attempt_number: 2,
      }),
    );
    // A second finding's attempts must not interfere
    await appendRepairAttempt(
      cwd,
      RUN_ID,
      TASK_ID,
      makeAttempt({
        id: "a_01CCCCCCCCCCCCCCCCCCCCCCCC",
        finding_id: "f_B",
        attempt_number: 5,
      }),
    );
    const latest = await readLatestRepairAttempt(cwd, RUN_ID, TASK_ID, "f_A");
    expect(latest?.id).toBe("a_01BBBBBBBBBBBBBBBBBBBBBBBB");
    expect(latest?.attempt_number).toBe(2);
  });
});

// ── RepairPolicyDecision ──────────────────────────────────────────────

describe("repair policy decisions", () => {
  function makeDecision(o: Partial<RepairPolicyDecision> = {}): RepairPolicyDecision {
    return {
      id: "d_01HXABCDEFGHJKMNPQRSTVWXYZ",
      finding_id: "f_01",
      run_id: RUN_ID,
      task_id: TASK_ID,
      decision: "allow_retry",
      requires_human_approval: true,
      reason_codes: ["variables_changed_ok"],
      guidance_budget_words: 750,
      created_at: isoAt(2026, 5, 21, 10),
      ...o,
    };
  }

  it("readActiveRepairDecision returns null for empty state", async () => {
    expect(
      await readActiveRepairDecision(cwd, RUN_ID, TASK_ID, "f_01"),
    ).toBeNull();
  });

  it("returns the only decision for a finding", async () => {
    await appendRepairDecision(cwd, RUN_ID, TASK_ID, makeDecision());
    const active = await readActiveRepairDecision(
      cwd,
      RUN_ID,
      TASK_ID,
      "f_01",
    );
    expect(active?.decision).toBe("allow_retry");
  });

  it("returns the most recent decision per finding_id (by created_at)", async () => {
    await appendRepairDecision(
      cwd,
      RUN_ID,
      TASK_ID,
      makeDecision({
        id: "d_01AAAAAAAAAAAAAAAAAAAAAAAA",
        decision: "allow_retry",
        created_at: isoAt(2026, 5, 21, 10),
      }),
    );
    await appendRepairDecision(
      cwd,
      RUN_ID,
      TASK_ID,
      makeDecision({
        id: "d_01BBBBBBBBBBBBBBBBBBBBBBBB",
        decision: "escalate_effort",
        reason_codes: ["escalation_ladder_step_available"],
        created_at: isoAt(2026, 5, 21, 11),
      }),
    );
    const active = await readActiveRepairDecision(
      cwd,
      RUN_ID,
      TASK_ID,
      "f_01",
    );
    expect(active?.decision).toBe("escalate_effort");
  });

  it("ignores decisions for other findings", async () => {
    await appendRepairDecision(
      cwd,
      RUN_ID,
      TASK_ID,
      makeDecision({
        finding_id: "f_other",
        decision: "stop_needs_human",
        reason_codes: ["max_attempts_reached"],
      }),
    );
    expect(
      await readActiveRepairDecision(cwd, RUN_ID, TASK_ID, "f_01"),
    ).toBeNull();
  });
});

// ── DraftReply ────────────────────────────────────────────────────────

describe("draft replies", () => {
  function makeReply(o: Partial<DraftReply> = {}): DraftReply {
    return {
      id: "dr_01HXABCDEFGHJKMNPQRSTVWXYZ",
      finding_id: "f_01",
      run_id: RUN_ID,
      task_id: TASK_ID,
      decision_id: "d_01",
      body_path: "REPAIR_GUIDANCE.md",
      body_word_count: 500,
      approval_status: "pending",
      created_at: isoAt(2026, 5, 21, 10),
      ...o,
    };
  }

  it("readDraftReplies returns [] for empty state", async () => {
    expect(await readDraftReplies(cwd, RUN_ID, TASK_ID)).toEqual([]);
  });

  it("round-trips a single reply", async () => {
    await appendDraftReply(cwd, RUN_ID, TASK_ID, makeReply());
    const all = await readDraftReplies(cwd, RUN_ID, TASK_ID);
    expect(all).toHaveLength(1);
    expect(all[0]!.approval_status).toBe("pending");
  });

  it("dedups by id with last-write-wins on approved_at ?? created_at", async () => {
    await appendDraftReply(
      cwd,
      RUN_ID,
      TASK_ID,
      makeReply({
        approval_status: "pending",
        created_at: isoAt(2026, 5, 21, 10),
      }),
    );
    await appendDraftReply(
      cwd,
      RUN_ID,
      TASK_ID,
      makeReply({
        approval_status: "approved",
        approved_by: "human",
        approved_at: isoAt(2026, 5, 21, 11),
        created_at: isoAt(2026, 5, 21, 10),
      }),
    );
    const all = await readDraftReplies(cwd, RUN_ID, TASK_ID);
    expect(all).toHaveLength(1);
    expect(all[0]!.approval_status).toBe("approved");
    expect(all[0]!.approved_by).toBe("human");
  });
});

// ── REPAIR_GUIDANCE.md ────────────────────────────────────────────────

describe("repair guidance", () => {
  it("readRepairGuidance returns null for empty state", async () => {
    expect(await readRepairGuidance(cwd, RUN_ID, TASK_ID)).toBeNull();
  });

  it("write/read round-trip", async () => {
    const md = "# Repair guidance\n\nFix the thing.\n";
    await writeRepairGuidance(cwd, RUN_ID, TASK_ID, md);
    expect(await readRepairGuidance(cwd, RUN_ID, TASK_ID)).toBe(md);
  });

  it("overwrites previous guidance atomically", async () => {
    await writeRepairGuidance(cwd, RUN_ID, TASK_ID, "v1");
    await writeRepairGuidance(cwd, RUN_ID, TASK_ID, "v2");
    expect(await readRepairGuidance(cwd, RUN_ID, TASK_ID)).toBe("v2");
  });
});

// ── §2.13 ReviewLoopEvent stream ──────────────────────────────────────

describe("review events", () => {
  function makeUserApproval(): ReviewLoopEvent {
    return {
      kind: "user_approval",
      event: {
        id: "ua_01HXABCDEFGHJKMNPQRSTVWXYZ",
        run_id: RUN_ID,
        task_id: TASK_ID,
        draft_reply_id: "dr_01",
        decision: "approved",
        created_at: isoAt(2026, 5, 21, 10),
      },
    };
  }

  function makeBatchReport(): ReviewLoopEvent {
    return {
      kind: "batch_report",
      event: {
        id: "br_01HXABCDEFGHJKMNPQRSTVWXYZ",
        run_id: RUN_ID,
        task_id: TASK_ID,
        source: "static_analysis",
        summary: "lint clean",
        finding_ids: [],
        created_at: isoAt(2026, 5, 21, 9),
      },
    };
  }

  it("readReviewEvents returns [] for empty state", async () => {
    expect(await readReviewEvents(cwd, RUN_ID, TASK_ID)).toEqual([]);
  });

  it("round-trips a single event", async () => {
    await appendReviewEvent(cwd, RUN_ID, TASK_ID, makeUserApproval());
    const all = await readReviewEvents(cwd, RUN_ID, TASK_ID);
    expect(all).toHaveLength(1);
    expect(all[0]!.kind).toBe("user_approval");
  });

  it("preserves chronological (append) order across kinds", async () => {
    await appendReviewEvent(cwd, RUN_ID, TASK_ID, makeBatchReport());
    await appendReviewEvent(cwd, RUN_ID, TASK_ID, makeUserApproval());
    const all = await readReviewEvents(cwd, RUN_ID, TASK_ID);
    expect(all.map((e) => e.kind)).toEqual(["batch_report", "user_approval"]);
  });

  it("filters by kind when requested", async () => {
    await appendReviewEvent(cwd, RUN_ID, TASK_ID, makeBatchReport());
    await appendReviewEvent(cwd, RUN_ID, TASK_ID, makeUserApproval());
    const onlyApprovals = await readReviewEvents(cwd, RUN_ID, TASK_ID, {
      kind: "user_approval",
    });
    expect(onlyApprovals).toHaveLength(1);
    expect(onlyApprovals[0]!.kind).toBe("user_approval");
  });
});
