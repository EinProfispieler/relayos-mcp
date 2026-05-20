import { describe, it, expect } from "vitest";
import {
  newRunId,
  isRunId,
  newExecutionWorkspaceId,
  isExecutionWorkspaceId,
} from "../src/id.js";
import {
  RunRecord,
  TaskLedgerEntry,
  ContinuationPacket,
  SourceIndexEntry,
  ExecutionWorkspace,
} from "../src/schema.js";

describe("Run / workspace IDs", () => {
  it("newRunId returns r_<ULID>", () => {
    const id = newRunId();
    expect(isRunId(id)).toBe(true);
    expect(id).toMatch(/^r_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("two newRunId calls produce different IDs", () => {
    expect(newRunId()).not.toBe(newRunId());
  });

  it("newExecutionWorkspaceId returns w_<ULID>", () => {
    const id = newExecutionWorkspaceId();
    expect(isExecutionWorkspaceId(id)).toBe(true);
    expect(id).toMatch(/^w_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("isRunId rejects non-run IDs", () => {
    expect(isRunId("r_short")).toBe(false);
    expect(isRunId("h_01HXABCDEFGHJKMNPQRSTVWXYZ")).toBe(false);
    expect(isRunId("")).toBe(false);
  });
});

describe("RunRecord", () => {
  it("validates a minimal active run", () => {
    const r = RunRecord.parse({
      id: "r_01HXABCDEFGHJKMNPQRSTVWXYZ",
      status: "active",
      started_at: "2026-05-20T10:00:00Z",
      task_count: 0,
      handoff_ids: [],
    });
    expect(r.status).toBe("active");
    expect(r.task_count).toBe(0);
  });

  it("rejects id without r_ prefix", () => {
    expect(() =>
      RunRecord.parse({
        id: "not_a_run",
        status: "active",
        started_at: "2026-05-20T10:00:00Z",
        task_count: 0,
        handoff_ids: [],
      }),
    ).toThrow();
  });

  it("rejects unknown status", () => {
    expect(() =>
      RunRecord.parse({
        id: "r_01",
        status: "paused",
        started_at: "x",
        task_count: 0,
        handoff_ids: [],
      }),
    ).toThrow();
  });

  it("rejects negative task_count", () => {
    expect(() =>
      RunRecord.parse({
        id: "r_01",
        status: "active",
        started_at: "x",
        task_count: -1,
        handoff_ids: [],
      }),
    ).toThrow();
  });
});

describe("TaskLedgerEntry", () => {
  it("validates a dispatched entry", () => {
    const e = TaskLedgerEntry.parse({
      seq: 1,
      task_id: "t_1",
      run_id: "r_01",
      user_input: "add hello fn",
      status: "dispatched",
      handoff_id: "h_01HXYZ",
      target_agent: "codex",
      model: "gpt-5.3-codex",
      effort: "medium",
      mode: "patch",
      created_at: "2026-05-20T10:01:00Z",
      updated_at: "2026-05-20T10:01:00Z",
    });
    expect(e.seq).toBe(1);
    expect(e.handoff_id).toBe("h_01HXYZ");
  });

  it("requires seq >= 1", () => {
    expect(() =>
      TaskLedgerEntry.parse({
        seq: 0,
        task_id: "t_1",
        run_id: "r_01",
        user_input: "x",
        status: "pending",
        created_at: "x",
        updated_at: "x",
      }),
    ).toThrow();
  });

  it("caps result_summary at 200 chars", () => {
    expect(() =>
      TaskLedgerEntry.parse({
        seq: 1,
        task_id: "t_1",
        run_id: "r_01",
        user_input: "x",
        status: "completed",
        result_summary: "x".repeat(201),
        created_at: "x",
        updated_at: "x",
      }),
    ).toThrow();
  });
});

describe("ContinuationPacket", () => {
  it("validates a packet", () => {
    const p = ContinuationPacket.parse({
      run_id: "r_01",
      generated_at: "2026-05-20T10:05:00Z",
      context_summary: "Adding hello function to util.ts",
      completed_task_ids: ["t_1"],
      pending_task_ids: [],
      open_questions: [],
      next_action: "Run tests",
      files_modified: ["src/util.ts"],
      token_budget_note: "compact after task 1",
    });
    expect(p.context_summary.length).toBeLessThanOrEqual(500);
  });

  it("rejects context_summary over 500 chars", () => {
    expect(() =>
      ContinuationPacket.parse({
        run_id: "r_01",
        generated_at: "x",
        context_summary: "x".repeat(501),
        completed_task_ids: [],
        pending_task_ids: [],
        open_questions: [],
        next_action: "x",
        files_modified: [],
        token_budget_note: "x",
      }),
    ).toThrow();
  });
});

describe("SourceIndexEntry", () => {
  it("validates a modified entry", () => {
    const e = SourceIndexEntry.parse({
      path: "src/util.ts",
      action: "modified",
      handoff_id: "h_01",
      task_seq: 1,
      ts: "2026-05-20T10:02:00Z",
    });
    expect(e.action).toBe("modified");
  });

  it("rejects unknown action", () => {
    expect(() =>
      SourceIndexEntry.parse({
        path: "x",
        action: "moved",
        ts: "x",
      }),
    ).toThrow();
  });
});

describe("ExecutionWorkspace", () => {
  it("validates a git_worktree owned by codex", () => {
    const w = ExecutionWorkspace.parse({
      id: "w_01HXABCDEFGHJKMNPQRSTVWXYZ",
      run_id: "r_01",
      task_id: "t_3",
      kind: "git_worktree",
      path: "/Users/x/GID/.claude/worktrees/feature-x",
      branch: "feat/x",
      base_sha: "abcdef1",
      head_sha: "1234567",
      owner_agent: "codex",
      purpose: "patch task 3",
      status: "active",
      created_at: "2026-05-20T10:00:00Z",
      updated_at: "2026-05-20T10:00:00Z",
      cleanup_policy: "auto_on_merge",
      related_handoff_id: "h_01HXYZ",
    });
    expect(w.kind).toBe("git_worktree");
    expect(w.owner_agent).toBe("codex");
  });

  it("rejects id without w_ prefix", () => {
    expect(() =>
      ExecutionWorkspace.parse({
        id: "ws_01",
        run_id: "r_01",
        kind: "main_checkout",
        path: "/x",
        owner_agent: "human",
        status: "active",
        created_at: "x",
        updated_at: "x",
        cleanup_policy: "manual",
      }),
    ).toThrow();
  });

  it("rejects unknown kind", () => {
    expect(() =>
      ExecutionWorkspace.parse({
        id: "w_01",
        run_id: "r_01",
        kind: "tarball",
        path: "/x",
        owner_agent: "human",
        status: "active",
        created_at: "x",
        updated_at: "x",
        cleanup_policy: "manual",
      }),
    ).toThrow();
  });

  it("rejects unknown status", () => {
    expect(() =>
      ExecutionWorkspace.parse({
        id: "w_01",
        run_id: "r_01",
        kind: "main_checkout",
        path: "/x",
        owner_agent: "human",
        status: "deleted",
        created_at: "x",
        updated_at: "x",
        cleanup_policy: "manual",
      }),
    ).toThrow();
  });

  it("rejects unknown cleanup_policy", () => {
    expect(() =>
      ExecutionWorkspace.parse({
        id: "w_01",
        run_id: "r_01",
        kind: "main_checkout",
        path: "/x",
        owner_agent: "human",
        status: "active",
        created_at: "x",
        updated_at: "x",
        cleanup_policy: "force",
      }),
    ).toThrow();
  });
});
