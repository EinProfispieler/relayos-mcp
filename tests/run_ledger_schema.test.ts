import { describe, it, expect } from "vitest";
import {
  newRunId,
  isRunId,
  newExecutionWorkspaceId,
  isExecutionWorkspaceId,
  newReviewFindingId,
  isReviewFindingId,
  newRepairAttemptId,
  isRepairAttemptId,
  newRepairDecisionId,
  isRepairDecisionId,
  newDraftReplyId,
  isDraftReplyId,
  newBatchReportId,
  isBatchReportId,
  newReviewPassId,
  isReviewPassId,
  newUserApprovalId,
  isUserApprovalId,
  newReplySentId,
  isReplySentId,
  newResultId,
  isResultId,
} from "../src/id.js";
import {
  RunRecord,
  TaskLedgerEntry,
  ContinuationPacket,
  SourceIndexEntry,
  ExecutionWorkspace,
  // Review / repair (Plan §2.8–§2.13)
  ReviewFinding,
  RepairAttempt,
  RepairPolicyDecision,
  DraftReply,
  EvidenceRef,
  BatchReport,
  ReviewPass,
  UserApproval,
  ReplySent,
  Result,
  ReviewLoopEvent,
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

// ── Plan §2.8–§2.13 — Review / Repair / Escalation schemas + IDs ─────

describe("Review/repair ID helpers", () => {
  const cases: Array<[string, () => string, (v: string) => boolean, RegExp]> = [
    ["newReviewFindingId", newReviewFindingId, isReviewFindingId, /^f_[0-9A-HJKMNP-TV-Z]{26}$/],
    ["newRepairAttemptId", newRepairAttemptId, isRepairAttemptId, /^a_[0-9A-HJKMNP-TV-Z]{26}$/],
    ["newRepairDecisionId", newRepairDecisionId, isRepairDecisionId, /^d_[0-9A-HJKMNP-TV-Z]{26}$/],
    ["newDraftReplyId", newDraftReplyId, isDraftReplyId, /^dr_[0-9A-HJKMNP-TV-Z]{26}$/],
    ["newBatchReportId", newBatchReportId, isBatchReportId, /^br_[0-9A-HJKMNP-TV-Z]{26}$/],
    ["newReviewPassId", newReviewPassId, isReviewPassId, /^rp_[0-9A-HJKMNP-TV-Z]{26}$/],
    ["newUserApprovalId", newUserApprovalId, isUserApprovalId, /^ua_[0-9A-HJKMNP-TV-Z]{26}$/],
    ["newReplySentId", newReplySentId, isReplySentId, /^rs_[0-9A-HJKMNP-TV-Z]{26}$/],
    ["newResultId", newResultId, isResultId, /^res_[0-9A-HJKMNP-TV-Z]{26}$/],
  ];

  for (const [name, mint, validate, pattern] of cases) {
    it(`${name} returns the expected prefix and validates`, () => {
      const id = mint();
      expect(id).toMatch(pattern);
      expect(validate(id)).toBe(true);
    });
    it(`${name} produces distinct IDs on successive calls`, () => {
      expect(mint()).not.toBe(mint());
    });
    it(`${name} validator rejects junk`, () => {
      expect(validate("")).toBe(false);
      expect(validate("x_01HXABCDEFGHJKMNPQRSTVWXYZ")).toBe(false);
      expect(validate("r_01HXABCDEFGHJKMNPQRSTVWXYZ")).toBe(false);
    });
  }

  // Cross-prefix isolation — e.g. an attempt id (a_) must not validate
  // as a review finding (f_), even though both are 26-char ULIDs.
  it("prefixes are mutually exclusive", () => {
    const f = newReviewFindingId();
    const a = newRepairAttemptId();
    const d = newRepairDecisionId();
    const dr = newDraftReplyId();
    const br = newBatchReportId();
    const rp = newReviewPassId();
    const ua = newUserApprovalId();
    const rs = newReplySentId();
    const res = newResultId();

    expect(isReviewFindingId(a)).toBe(false);
    expect(isRepairAttemptId(f)).toBe(false);
    expect(isRepairDecisionId(dr)).toBe(false);
    expect(isDraftReplyId(d)).toBe(false);
    expect(isBatchReportId(rp)).toBe(false);
    expect(isReviewPassId(br)).toBe(false);
    expect(isUserApprovalId(rs)).toBe(false);
    expect(isReplySentId(ua)).toBe(false);
    expect(isResultId(rs)).toBe(false);
  });
});

describe("EvidenceRef discriminated union", () => {
  it("file variant accepts optional line_start/end", () => {
    const ref = EvidenceRef.parse({
      kind: "file",
      path: "src/util.ts",
      line_start: 10,
      line_end: 20,
    });
    expect(ref.kind).toBe("file");
  });

  it("test variant accepts file + optional name", () => {
    const ref = EvidenceRef.parse({
      kind: "test",
      file: "tests/foo.test.ts",
      name: "happy path",
    });
    expect(ref.kind).toBe("test");
  });

  it("command variant requires non-empty argv", () => {
    const ref = EvidenceRef.parse({
      kind: "command",
      argv: ["npm", "test"],
      exit_code: 1,
      output_excerpt: "TypeError: …",
    });
    expect(ref.kind).toBe("command");
    expect(() => EvidenceRef.parse({ kind: "command", argv: [] })).toThrow();
  });

  it("handoff / commit / ledger variants accept their required fields", () => {
    expect(EvidenceRef.parse({ kind: "handoff", handoff_id: "h_01" }).kind).toBe(
      "handoff",
    );
    expect(EvidenceRef.parse({ kind: "commit", sha: "abcdef1" }).kind).toBe(
      "commit",
    );
    expect(
      EvidenceRef.parse({ kind: "ledger", run_id: "r_01", task_seq: 3 }).kind,
    ).toBe("ledger");
  });

  it("rejects unknown discriminator", () => {
    expect(() => EvidenceRef.parse({ kind: "tarball" } as never)).toThrow();
  });

  it("rejects extra fields on a known variant", () => {
    expect(() =>
      EvidenceRef.parse({
        kind: "commit",
        sha: "abc",
        rogue_field: true,
      } as never),
    ).toThrow();
  });
});

describe("ReviewFinding", () => {
  function base(o: Partial<{ [k: string]: unknown }> = {}) {
    return {
      id: "f_01HXABCDEFGHJKMNPQRSTVWXYZ",
      run_id: "r_01",
      task_id: "t_1",
      reviewer: "claude",
      severity: "warn",
      category: "missing_tests",
      title: "Missing test for X",
      summary: "X has no test coverage; reproduce with Y",
      evidence_refs: [],
      status: "open",
      created_at: "2026-05-21T10:00:00Z",
      updated_at: "2026-05-21T10:00:00Z",
      ...o,
    };
  }

  it("validates a minimal finding", () => {
    const f = ReviewFinding.parse(base());
    expect(f.id).toMatch(/^f_/);
    expect(f.reviewer).toBe("claude");
  });

  it("rejects id without f_ prefix", () => {
    expect(() => ReviewFinding.parse(base({ id: "x_01" }))).toThrow();
  });

  it("rejects unknown reviewer / severity / category / status", () => {
    expect(() => ReviewFinding.parse(base({ reviewer: "qa-bot" }))).toThrow();
    expect(() => ReviewFinding.parse(base({ severity: "critical" }))).toThrow();
    expect(() => ReviewFinding.parse(base({ category: "weird" }))).toThrow();
    expect(() => ReviewFinding.parse(base({ status: "in_progress" }))).toThrow();
  });

  it("title capped at 120 chars", () => {
    expect(() => ReviewFinding.parse(base({ title: "x".repeat(121) }))).toThrow();
  });

  it("summary capped at 600 chars", () => {
    expect(() => ReviewFinding.parse(base({ summary: "x".repeat(601) }))).toThrow();
  });
});

describe("RepairAttempt", () => {
  function base(o: Partial<{ [k: string]: unknown }> = {}) {
    return {
      id: "a_01HXABCDEFGHJKMNPQRSTVWXYZ",
      finding_id: "f_01",
      run_id: "r_01",
      task_id: "t_1",
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
      created_at: "2026-05-21T10:00:00Z",
      ...o,
    };
  }

  it("validates an Attempt 1 with empty changed_variables", () => {
    const a = RepairAttempt.parse(base());
    expect(a.attempt_number).toBe(1);
    expect(a.changed_variables_since_previous_attempt).toEqual([]);
  });

  it("Attempt 2 with empty changed_variables ALSO parses at the schema level", () => {
    // The variable-change rule (§3.2) is intentionally NOT enforced
    // by the schema. Task 12's evaluateRepairPolicy() is what rejects
    // this — keeping the rule in the schema would make malformed
    // ledger files un-readable, which would break the §6 recovery
    // protocol.
    const a = RepairAttempt.parse(base({ attempt_number: 2 }));
    expect(a.attempt_number).toBe(2);
    expect(a.changed_variables_since_previous_attempt).toEqual([]);
  });

  it("all seven RepairVariableChange axes are accepted", () => {
    const a = RepairAttempt.parse(
      base({
        changed_variables_since_previous_attempt: [
          "effort",
          "model",
          "provider",
          "mode",
          "scope",
          "tests",
          "reviewer",
        ],
      }),
    );
    expect(a.changed_variables_since_previous_attempt).toHaveLength(7);
  });

  it("rejects unknown variable-change axis", () => {
    expect(() =>
      RepairAttempt.parse(
        base({ changed_variables_since_previous_attempt: ["temperature"] }),
      ),
    ).toThrow();
  });

  it("prompt_summary capped at 240 chars", () => {
    expect(() =>
      RepairAttempt.parse(base({ prompt_summary: "x".repeat(241) })),
    ).toThrow();
  });

  it("escalation_reason capped at 240 chars when present", () => {
    expect(() =>
      RepairAttempt.parse(
        base({ escalation_reason: "x".repeat(241), attempt_number: 2 }),
      ),
    ).toThrow();
  });

  it("required_scope is required and strict", () => {
    expect(() =>
      RepairAttempt.parse(base({ required_scope: undefined })),
    ).toThrow();
  });

  it("required_tests is required (empty array OK)", () => {
    const a = RepairAttempt.parse(base({ required_tests: [] }));
    expect(a.required_tests).toEqual([]);
    expect(() => RepairAttempt.parse(base({ required_tests: undefined }))).toThrow();
  });

  it("rejects unknown reviewer / provider / effort / mode / result", () => {
    expect(() => RepairAttempt.parse(base({ reviewer: "qa-bot" }))).toThrow();
    expect(() => RepairAttempt.parse(base({ provider: "glm" }))).toThrow();
    expect(() => RepairAttempt.parse(base({ effort: "ultra" }))).toThrow();
    expect(() => RepairAttempt.parse(base({ mode: "yolo" }))).toThrow();
    expect(() => RepairAttempt.parse(base({ result: "maybe" }))).toThrow();
  });
});

describe("RepairPolicyDecision", () => {
  function base(o: Partial<{ [k: string]: unknown }> = {}) {
    return {
      id: "d_01HXABCDEFGHJKMNPQRSTVWXYZ",
      finding_id: "f_01",
      run_id: "r_01",
      task_id: "t_1",
      decision: "allow_retry",
      requires_human_approval: true,
      reason_codes: ["variables_changed_ok"],
      guidance_budget_words: 750,
      created_at: "2026-05-21T10:00:00Z",
      ...o,
    };
  }

  it("validates a minimal allow_retry decision", () => {
    const d = RepairPolicyDecision.parse(base());
    expect(d.decision).toBe("allow_retry");
  });

  it("requires at least one reason_code", () => {
    expect(() => RepairPolicyDecision.parse(base({ reason_codes: [] }))).toThrow();
  });

  it("rejects unknown reason_code", () => {
    expect(() =>
      RepairPolicyDecision.parse(base({ reason_codes: ["i_dunno"] })),
    ).toThrow();
  });

  it("guidance_budget_words capped at 1200 (hard cap)", () => {
    expect(() =>
      RepairPolicyDecision.parse(base({ guidance_budget_words: 1201 })),
    ).toThrow();
  });

  it("guidance_budget_words floor at 300 (any smaller can't fit the 9 §3.8 sections)", () => {
    expect(() =>
      RepairPolicyDecision.parse(base({ guidance_budget_words: 299 })),
    ).toThrow();
  });

  it("guidance_budget_words = 1200 is accepted (boundary)", () => {
    expect(
      RepairPolicyDecision.parse(base({ guidance_budget_words: 1200 }))
        .guidance_budget_words,
    ).toBe(1200);
  });
});

describe("DraftReply", () => {
  function base(o: Partial<{ [k: string]: unknown }> = {}) {
    return {
      id: "dr_01HXABCDEFGHJKMNPQRSTVWXYZ",
      finding_id: "f_01",
      run_id: "r_01",
      task_id: "t_1",
      decision_id: "d_01",
      body_path: "REPAIR_GUIDANCE.md",
      body_word_count: 500,
      approval_status: "pending",
      created_at: "2026-05-21T10:00:00Z",
      ...o,
    };
  }

  it("validates a pending draft", () => {
    const dr = DraftReply.parse(base());
    expect(dr.approval_status).toBe("pending");
  });

  it("rejects unknown approval_status", () => {
    expect(() =>
      DraftReply.parse(base({ approval_status: "approved-ish" })),
    ).toThrow();
  });

  it("body_word_count capped at 1200", () => {
    expect(() =>
      DraftReply.parse(base({ body_word_count: 1201 })),
    ).toThrow();
  });

  it("approved_by literal 'human' only", () => {
    expect(() => DraftReply.parse(base({ approved_by: "bot" }))).toThrow();
    expect(
      DraftReply.parse(base({ approved_by: "human" })).approved_by,
    ).toBe("human");
  });
});

describe("§2.13 event records", () => {
  it("BatchReport summary capped at 600 chars", () => {
    const ok = BatchReport.parse({
      id: "br_01HXABCDEFGHJKMNPQRSTVWXYZ",
      run_id: "r_01",
      task_id: "t_1",
      source: "human",
      summary: "looks good",
      finding_ids: [],
      created_at: "x",
    });
    expect(ok.source).toBe("human");
    expect(() =>
      BatchReport.parse({
        id: "br_01",
        run_id: "r_01",
        task_id: "t_1",
        source: "human",
        summary: "x".repeat(601),
        finding_ids: [],
        created_at: "x",
      }),
    ).toThrow();
  });

  it("ReviewPass requires scope.{files,commands}", () => {
    const rp = ReviewPass.parse({
      id: "rp_01HXABCDEFGHJKMNPQRSTVWXYZ",
      run_id: "r_01",
      task_id: "t_1",
      reviewer: "static_analysis",
      scope: { files: ["src/util.ts"], commands: ["npm test"] },
      finding_ids: ["f_01"],
      evidence_refs: [],
      created_at: "x",
    });
    expect(rp.scope.files).toEqual(["src/util.ts"]);
    expect(() =>
      ReviewPass.parse({
        id: "rp_01",
        run_id: "r_01",
        task_id: "t_1",
        reviewer: "human",
        scope: { files: [] }, // missing commands
        finding_ids: [],
        evidence_refs: [],
        created_at: "x",
      } as never),
    ).toThrow();
  });

  it("UserApproval decision must be approved|rejected", () => {
    expect(
      UserApproval.parse({
        id: "ua_01HXABCDEFGHJKMNPQRSTVWXYZ",
        run_id: "r_01",
        task_id: "t_1",
        draft_reply_id: "dr_01",
        decision: "approved",
        created_at: "x",
      }).decision,
    ).toBe("approved");
    expect(() =>
      UserApproval.parse({
        id: "ua_01",
        run_id: "r_01",
        task_id: "t_1",
        draft_reply_id: "dr_01",
        decision: "maybe",
        created_at: "x",
      }),
    ).toThrow();
  });

  it("ReplySent provider must be in the RepairProvider enum", () => {
    expect(
      ReplySent.parse({
        id: "rs_01HXABCDEFGHJKMNPQRSTVWXYZ",
        run_id: "r_01",
        task_id: "t_1",
        draft_reply_id: "dr_01",
        provider: "codex",
        created_at: "x",
      }).provider,
    ).toBe("codex");
    expect(() =>
      ReplySent.parse({
        id: "rs_01",
        run_id: "r_01",
        task_id: "t_1",
        draft_reply_id: "dr_01",
        provider: "glm",
        created_at: "x",
      }),
    ).toThrow();
  });

  it("Result.summary capped at 600 chars; status enum locked", () => {
    expect(
      Result.parse({
        id: "res_01HXABCDEFGHJKMNPQRSTVWXYZ",
        run_id: "r_01",
        task_id: "t_1",
        status: "fixed",
        summary: "all green",
        evidence_refs: [],
        created_at: "x",
      }).status,
    ).toBe("fixed");
    expect(() =>
      Result.parse({
        id: "res_01",
        run_id: "r_01",
        task_id: "t_1",
        status: "fixed",
        summary: "x".repeat(601),
        evidence_refs: [],
        created_at: "x",
      }),
    ).toThrow();
    expect(() =>
      Result.parse({
        id: "res_01",
        run_id: "r_01",
        task_id: "t_1",
        status: "kinda",
        summary: "x",
        evidence_refs: [],
        created_at: "x",
      }),
    ).toThrow();
  });

  it("ReviewLoopEvent tagged union round-trips each kind", () => {
    const samples = [
      {
        kind: "batch_report" as const,
        event: {
          id: "br_01HXABCDEFGHJKMNPQRSTVWXYZ",
          run_id: "r_01",
          task_id: "t_1",
          source: "human" as const,
          summary: "ok",
          finding_ids: [],
          created_at: "x",
        },
      },
      {
        kind: "user_approval" as const,
        event: {
          id: "ua_01HXABCDEFGHJKMNPQRSTVWXYZ",
          run_id: "r_01",
          task_id: "t_1",
          draft_reply_id: "dr_01",
          decision: "approved" as const,
          created_at: "x",
        },
      },
    ];
    for (const s of samples) {
      const parsed = ReviewLoopEvent.parse(s);
      expect(parsed.kind).toBe(s.kind);
    }
    expect(() =>
      ReviewLoopEvent.parse({ kind: "noise", event: {} } as never),
    ).toThrow();
  });
});
