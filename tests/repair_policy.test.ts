/**
 * Tests for the repair policy engine (Plan Task 12).
 *
 * Coverage by Plan section:
 *   §3.2 — variable-change rule across all seven axes
 *   §3.3 — escalation ladder (effort → model → provider)
 *   §3.4 — explicit trigger handling
 *   §3.5 — stop conditions
 *   §3.6 — every decision requires human approval
 *   §3.8 — guidance_budget_words default + clamp
 *
 * No file IO. No agent dispatch. The engine is a pure function.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateRepairPolicy,
  diffVariableAxes,
  DEFAULT_GUIDANCE_BUDGET_WORDS,
  MAX_STRUCTURED_ATTEMPTS,
  type EvaluateRepairPolicyInput,
  type ModelLadderConfig,
  type ProposedNextAttempt,
} from "../src/repair_policy.js";
import type {
  RepairAttempt,
  RepairPolicyDecision,
  ReviewFinding,
} from "../src/schema.js";

// ── Fixtures ─────────────────────────────────────────────────────────

const RUN_ID = "r_01HXABCDEFGHJKMNPQRSTVWXYZ";
const TASK_ID = "t_1";
const FINDING_ID = "f_01HXABCDEFGHJKMNPQRSTVWXYZ";

function makeFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    id: FINDING_ID,
    run_id: RUN_ID,
    task_id: TASK_ID,
    reviewer: "claude",
    severity: "warn",
    category: "missing_tests",
    title: "thing is broken",
    summary: "thing is broken in src/util.ts",
    evidence_refs: [],
    status: "open",
    created_at: "2026-05-21T10:00:00Z",
    updated_at: "2026-05-21T10:00:00Z",
    ...overrides,
  };
}

function makeAttempt(overrides: Partial<RepairAttempt> = {}): RepairAttempt {
  return {
    id: "a_01HXABCDEFGHJKMNPQRSTVWXYZ",
    finding_id: FINDING_ID,
    run_id: RUN_ID,
    task_id: TASK_ID,
    attempt_number: 1,
    provider: "codex",
    model: "gpt-5.3-codex",
    effort: "medium",
    mode: "patch",
    changed_variables_since_previous_attempt: [],
    prompt_summary: "fix the thing",
    required_scope: { allowed_files: ["src/util.ts"], forbidden_files: [] },
    required_tests: ["tests/util.test.ts"],
    reviewer: "claude",
    result: "failed",
    evidence_refs: [],
    created_at: "2026-05-21T10:00:00Z",
    ...overrides,
  };
}

function makeProposed(
  overrides: Partial<ProposedNextAttempt> = {},
): ProposedNextAttempt {
  return {
    provider: "codex",
    model: "gpt-5.3-codex",
    effort: "medium",
    mode: "patch",
    required_scope: { allowed_files: ["src/util.ts"], forbidden_files: [] },
    required_tests: ["tests/util.test.ts"],
    reviewer: "claude",
    ...overrides,
  };
}

const FULL_LADDER: ModelLadderConfig = {
  effort_order: ["low", "medium", "high", "xhigh", "max"],
  model_tiers_by_provider: {
    claude: ["claude-sonnet-4-6", "claude-opus-4-7"],
    codex: ["gpt-5.3-codex", "gpt-5.5"],
    other: [],
  },
};

const EMPTY_LADDER: ModelLadderConfig = {
  effort_order: [],
  model_tiers_by_provider: { claude: [], codex: [], other: [] },
};

function baseInput(
  overrides: Partial<EvaluateRepairPolicyInput> = {},
): EvaluateRepairPolicyInput {
  return {
    finding: makeFinding(),
    attempts: [],
    proposed_next: makeProposed(),
    triggers: [],
    ladder: FULL_LADDER,
    ...overrides,
  };
}

/** Locks in the Plan §3.6 invariant across the full suite. */
function assertHumanApprovalAndReasonCodes(d: RepairPolicyDecision): void {
  expect(d.requires_human_approval).toBe(true);
  expect(d.reason_codes.length).toBeGreaterThanOrEqual(1);
}

// ── §3.2 — Variable comparison ───────────────────────────────────────

describe("diffVariableAxes (Plan §3.2)", () => {
  it("returns [] when proposed matches latest across all 7 axes", () => {
    const latest = makeAttempt();
    const proposed = makeProposed();
    expect(diffVariableAxes(latest, proposed)).toEqual([]);
  });

  it("detects provider change", () => {
    expect(
      diffVariableAxes(makeAttempt(), makeProposed({ provider: "claude" })),
    ).toEqual(["provider"]);
  });

  it("detects model change", () => {
    expect(
      diffVariableAxes(makeAttempt(), makeProposed({ model: "different" })),
    ).toEqual(["model"]);
  });

  it("detects effort change", () => {
    expect(
      diffVariableAxes(makeAttempt(), makeProposed({ effort: "high" })),
    ).toEqual(["effort"]);
  });

  it("detects mode change", () => {
    expect(
      diffVariableAxes(
        makeAttempt(),
        makeProposed({ mode: "patch_after_diagnosis" }),
      ),
    ).toEqual(["mode"]);
  });

  it("detects scope change (added file)", () => {
    expect(
      diffVariableAxes(
        makeAttempt(),
        makeProposed({
          required_scope: {
            allowed_files: ["src/util.ts", "src/other.ts"],
            forbidden_files: [],
          },
        }),
      ),
    ).toEqual(["scope"]);
  });

  it("detects scope change (forbidden file added)", () => {
    expect(
      diffVariableAxes(
        makeAttempt(),
        makeProposed({
          required_scope: {
            allowed_files: ["src/util.ts"],
            forbidden_files: ["src/secret.ts"],
          },
        }),
      ),
    ).toEqual(["scope"]);
  });

  it("scope comparison is order-insensitive", () => {
    const latest = makeAttempt({
      required_scope: { allowed_files: ["a.ts", "b.ts"], forbidden_files: [] },
    });
    const proposed = makeProposed({
      required_scope: { allowed_files: ["b.ts", "a.ts"], forbidden_files: [] },
    });
    expect(diffVariableAxes(latest, proposed)).toEqual([]);
  });

  it("detects tests change", () => {
    expect(
      diffVariableAxes(
        makeAttempt(),
        makeProposed({
          required_tests: ["tests/util.test.ts", "tests/other.test.ts"],
        }),
      ),
    ).toEqual(["tests"]);
  });

  it("tests comparison is order-insensitive", () => {
    expect(
      diffVariableAxes(
        makeAttempt({ required_tests: ["a", "b"] }),
        makeProposed({ required_tests: ["b", "a"] }),
      ),
    ).toEqual([]);
  });

  it("detects reviewer change", () => {
    expect(
      diffVariableAxes(
        makeAttempt(),
        makeProposed({ reviewer: "static_analysis" }),
      ),
    ).toEqual(["reviewer"]);
  });

  it("returns multiple axes when more than one differs", () => {
    expect(
      diffVariableAxes(
        makeAttempt(),
        makeProposed({ effort: "high", reviewer: "static_analysis" }),
      ).sort(),
    ).toEqual(["effort", "reviewer"].sort());
  });
});

// ── Attempt 1 ────────────────────────────────────────────────────────

describe("Attempt 1 (no prior attempts)", () => {
  it("returns allow_retry with human approval required", () => {
    const d = evaluateRepairPolicy(baseInput({ attempts: [] }));
    expect(d.decision).toBe("allow_retry");
    assertHumanApprovalAndReasonCodes(d);
  });

  it("decision carries the proposed_next axes", () => {
    const d = evaluateRepairPolicy(
      baseInput({
        attempts: [],
        proposed_next: makeProposed({ effort: "high" }),
      }),
    );
    expect(d.next_effort).toBe("high");
    expect(d.next_provider).toBe("codex");
    expect(d.next_mode).toBe("patch");
  });

  it("guidance_budget_words defaults to 750", () => {
    const d = evaluateRepairPolicy(baseInput());
    expect(d.guidance_budget_words).toBe(DEFAULT_GUIDANCE_BUDGET_WORDS);
    expect(d.guidance_budget_words).toBe(750);
  });

  it("guidance_budget_words clamps to schema cap (1200)", () => {
    const d = evaluateRepairPolicy(
      baseInput({ guidance_budget_words: 5000 }),
    );
    expect(d.guidance_budget_words).toBe(1200);
  });

  it("guidance_budget_words clamps to schema floor (300)", () => {
    const d = evaluateRepairPolicy(
      baseInput({ guidance_budget_words: 50 }),
    );
    expect(d.guidance_budget_words).toBe(300);
  });

  it("guidance_budget_words honors an in-range request", () => {
    const d = evaluateRepairPolicy(
      baseInput({ guidance_budget_words: 900 }),
    );
    expect(d.guidance_budget_words).toBe(900);
  });
});

// ── §3.2 — Variable-change rule across all seven axes ────────────────

describe("Variable-change rule: each axis counts as a valid change", () => {
  // After a failed attempt with everything identical except one axis,
  // the engine must NOT return same_model_effort_mode_requested. It
  // may either allow_retry (when the failure-trigger-set is empty) or
  // escalate — but the changed-axes set must include the differing
  // axis.
  const cases: Array<[string, Partial<ProposedNextAttempt>, string]> = [
    ["provider", { provider: "claude" }, "provider"],
    ["model", { model: "claude-sonnet-4-6" }, "model"],
    ["effort", { effort: "high" }, "effort"],
    ["mode", { mode: "patch_after_diagnosis" }, "mode"],
    [
      "scope",
      {
        required_scope: {
          allowed_files: ["src/util.ts", "src/extra.ts"],
          forbidden_files: [],
        },
      },
      "scope",
    ],
    [
      "tests",
      {
        required_tests: ["tests/util.test.ts", "tests/extra.test.ts"],
      },
      "tests",
    ],
    ["reviewer", { reviewer: "static_analysis" }, "reviewer"],
  ];

  for (const [name, proposedDelta, expectedAxis] of cases) {
    it(`${name} change is accepted as a valid variable change`, () => {
      const latest = makeAttempt({ result: "failed" });
      const proposed = makeProposed(proposedDelta);
      // sanity: diff should include the expected axis
      expect(diffVariableAxes(latest, proposed)).toContain(expectedAxis);

      const d = evaluateRepairPolicy(
        baseInput({
          attempts: [latest],
          proposed_next: proposed,
        }),
      );
      // The decision is not the same_model_effort_mode_requested stop
      expect(d.reason_codes).not.toContain("same_model_effort_mode_requested");
      // And it doesn't force human-stop on this ground alone (it may
      // still escalate; either way it's not a same-everything stop).
      const isStopOnIdentity =
        d.decision === "stop_needs_human" &&
        d.reason_codes.includes("same_model_effort_mode_requested");
      expect(isStopOnIdentity).toBe(false);
      assertHumanApprovalAndReasonCodes(d);
    });
  }

  // The plan amendment calls out tests and reviewer specifically.
  it("required_tests change does NOT trigger same_model_effort_mode_requested", () => {
    const latest = makeAttempt({
      result: "failed",
      required_tests: ["tests/a.test.ts"],
    });
    const proposed = makeProposed({
      required_tests: ["tests/a.test.ts", "tests/b.test.ts"],
    });
    const d = evaluateRepairPolicy(
      baseInput({ attempts: [latest], proposed_next: proposed }),
    );
    expect(d.reason_codes).not.toContain("same_model_effort_mode_requested");
    expect(d.decision).not.toBe("stop_needs_human");
  });

  it("reviewer change does NOT trigger same_model_effort_mode_requested", () => {
    const latest = makeAttempt({ result: "failed", reviewer: "claude" });
    const proposed = makeProposed({ reviewer: "static_analysis" });
    const d = evaluateRepairPolicy(
      baseInput({ attempts: [latest], proposed_next: proposed }),
    );
    expect(d.reason_codes).not.toContain("same_model_effort_mode_requested");
    expect(d.decision).not.toBe("stop_needs_human");
  });
});

// ── Failed-repair invariant ──────────────────────────────────────────

describe("Failed-repair invariant (Plan Verification item 15)", () => {
  // For every failed/incomplete latest attempt, the engine must
  // return EITHER stop_needs_human OR a proposed next that differs
  // from latest in ≥ 1 RepairVariableChange axis.

  it("incomplete + same-everything: stops OR escalates (never plain allow_retry)", () => {
    const latest = makeAttempt({ result: "incomplete" });
    const proposed = makeProposed();
    const d = evaluateRepairPolicy(
      baseInput({ attempts: [latest], proposed_next: proposed }),
    );
    const ok =
      d.decision === "stop_needs_human" ||
      d.decision === "escalate_effort" ||
      d.decision === "escalate_model" ||
      d.decision === "switch_provider" ||
      d.decision === "switch_to_diagnosis";
    expect(ok).toBe(true);
    expect(d.decision).not.toBe("allow_retry");
    assertHumanApprovalAndReasonCodes(d);
  });

  it("failed + same-everything + empty ladder: stop_needs_human(same_model_effort_mode_requested)", () => {
    const latest = makeAttempt({ result: "failed" });
    const d = evaluateRepairPolicy(
      baseInput({
        attempts: [latest],
        proposed_next: makeProposed(),
        ladder: EMPTY_LADDER,
      }),
    );
    expect(d.decision).toBe("stop_needs_human");
    expect(d.reason_codes).toContain("same_model_effort_mode_requested");
    assertHumanApprovalAndReasonCodes(d);
  });

  it("property sweep: each axis as the lone change keeps engine off same-everything stop", () => {
    const axes: Array<Partial<ProposedNextAttempt>> = [
      { provider: "claude" },
      { model: "claude-sonnet-4-6" },
      { effort: "high" },
      { mode: "patch_after_diagnosis" },
      {
        required_scope: {
          allowed_files: ["src/x.ts"],
          forbidden_files: [],
        },
      },
      { required_tests: ["tests/x.test.ts", "tests/y.test.ts"] },
      { reviewer: "human" },
    ];
    for (const delta of axes) {
      const latest = makeAttempt({ result: "failed" });
      const d = evaluateRepairPolicy(
        baseInput({
          attempts: [latest],
          proposed_next: makeProposed(delta),
        }),
      );
      const stoppedOnIdentity =
        d.decision === "stop_needs_human" &&
        d.reason_codes.includes("same_model_effort_mode_requested");
      expect(stoppedOnIdentity).toBe(false);
      assertHumanApprovalAndReasonCodes(d);
    }
  });
});

// ── §3.3 — Escalation ladder ─────────────────────────────────────────

describe("Escalation ladder (Plan §3.3)", () => {
  it("Attempt 2 after failed Attempt 1 with same-everything: escalate_effort (medium → high)", () => {
    const latest = makeAttempt({ result: "failed", effort: "medium" });
    const d = evaluateRepairPolicy(
      baseInput({
        attempts: [latest],
        proposed_next: makeProposed({ effort: "medium" }),
      }),
    );
    expect(d.decision).toBe("escalate_effort");
    expect(d.next_effort).toBe("high");
    assertHumanApprovalAndReasonCodes(d);
  });

  it("Attempt 2 escalates effort when ladder allows (low → medium)", () => {
    const latest = makeAttempt({ result: "failed", effort: "low" });
    const d = evaluateRepairPolicy(
      baseInput({
        attempts: [latest],
        proposed_next: makeProposed({ effort: "low" }),
      }),
    );
    expect(d.decision).toBe("escalate_effort");
    expect(d.next_effort).toBe("medium");
  });

  it("escalates model when effort ladder is exhausted (effort=max)", () => {
    const latest = makeAttempt({
      result: "failed",
      effort: "max",
      attempt_number: 2,
    });
    const d = evaluateRepairPolicy(
      baseInput({
        attempts: [latest],
        proposed_next: makeProposed({ effort: "max" }),
      }),
    );
    expect(d.decision).toBe("escalate_model");
    expect(d.next_model).toBe("gpt-5.5");
    assertHumanApprovalAndReasonCodes(d);
  });

  it("switches provider when both effort and model ladders are exhausted (attempt ≥ 2)", () => {
    const latest = makeAttempt({
      result: "failed",
      effort: "max",
      model: "gpt-5.5", // top of codex tier
      attempt_number: 2,
    });
    const d = evaluateRepairPolicy(
      baseInput({
        attempts: [latest],
        proposed_next: makeProposed({ effort: "max", model: "gpt-5.5" }),
      }),
    );
    expect(d.decision).toBe("switch_provider");
    expect(d.next_provider).toBe("claude");
    assertHumanApprovalAndReasonCodes(d);
  });
});

// ── §3.5 — Stop conditions ───────────────────────────────────────────

describe("Stop conditions (Plan §3.5)", () => {
  it("attempt_number >= MAX with no new variable: stop_needs_human(max_attempts_reached)", () => {
    const latest = makeAttempt({
      result: "failed",
      attempt_number: MAX_STRUCTURED_ATTEMPTS,
    });
    const d = evaluateRepairPolicy(
      baseInput({
        attempts: [latest],
        proposed_next: makeProposed(),
      }),
    );
    expect(d.decision).toBe("stop_needs_human");
    expect(d.reason_codes).toContain("max_attempts_reached");
    assertHumanApprovalAndReasonCodes(d);
  });

  it("attempt_number >= MAX but a variable changed: allows non-stop progression", () => {
    const latest = makeAttempt({
      result: "failed",
      attempt_number: MAX_STRUCTURED_ATTEMPTS,
    });
    const d = evaluateRepairPolicy(
      baseInput({
        attempts: [latest],
        proposed_next: makeProposed({ effort: "high" }),
      }),
    );
    // Either allow_retry (a real change) or an escalate decision —
    // never max_attempts_reached because a variable changed.
    expect(d.reason_codes).not.toContain("max_attempts_reached");
  });
});

// ── §3.4 — Triggers ──────────────────────────────────────────────────

describe("Triggers (Plan §3.4)", () => {
  it("forbidden_file_touched + scope still touches forbidden file → stop", () => {
    const d = evaluateRepairPolicy(
      baseInput({
        triggers: ["forbidden_file_touched"],
        proposed_next: makeProposed({
          required_scope: {
            allowed_files: ["src/util.ts", "src/secret.ts"],
            forbidden_files: ["src/secret.ts"],
          },
        }),
      }),
    );
    expect(d.decision).toBe("stop_needs_human");
    expect(d.reason_codes).toContain("forbidden_file_touched");
    assertHumanApprovalAndReasonCodes(d);
  });

  it("forbidden_file_touched + scope narrowed but mode still patch → switch_to_diagnosis", () => {
    const d = evaluateRepairPolicy(
      baseInput({
        triggers: ["forbidden_file_touched"],
        proposed_next: makeProposed({
          required_scope: {
            allowed_files: ["src/util.ts"],
            forbidden_files: ["src/secret.ts"],
          },
          mode: "patch",
        }),
      }),
    );
    expect(d.decision).toBe("switch_to_diagnosis");
    expect(d.next_mode).toBe("diagnosis_only");
    expect(d.reason_codes).toContain("forbidden_file_touched");
    assertHumanApprovalAndReasonCodes(d);
  });

  it("test_modified_to_pass + proposed mode is still raw patch → stop", () => {
    const d = evaluateRepairPolicy(
      baseInput({
        triggers: ["test_modified_to_pass"],
        proposed_next: makeProposed({ mode: "patch" }),
      }),
    );
    expect(d.decision).toBe("stop_needs_human");
    expect(d.reason_codes).toContain("test_modified_to_pass");
    assertHumanApprovalAndReasonCodes(d);
  });

  it("test_modified_to_pass + proposed mode is diagnosis_only → switch_to_diagnosis", () => {
    const d = evaluateRepairPolicy(
      baseInput({
        triggers: ["test_modified_to_pass"],
        proposed_next: makeProposed({ mode: "diagnosis_only" }),
      }),
    );
    expect(d.decision).toBe("switch_to_diagnosis");
    expect(d.reason_codes).toContain("test_modified_to_pass");
  });

  it("scope_expanded + proposed allowed_files NOT narrower → stop", () => {
    const latest = makeAttempt({
      required_scope: { allowed_files: ["src/util.ts"], forbidden_files: [] },
    });
    const d = evaluateRepairPolicy(
      baseInput({
        attempts: [latest],
        triggers: ["scope_expanded"],
        proposed_next: makeProposed({
          required_scope: {
            allowed_files: ["src/util.ts", "src/other.ts"],
            forbidden_files: [],
          },
        }),
      }),
    );
    expect(d.decision).toBe("stop_needs_human");
    expect(d.reason_codes).toContain("scope_expanded");
  });

  it("scope_expanded + proposed allowed_files narrowed: not stopped on this ground", () => {
    const latest = makeAttempt({
      required_scope: {
        allowed_files: ["a.ts", "b.ts"],
        forbidden_files: [],
      },
    });
    const d = evaluateRepairPolicy(
      baseInput({
        attempts: [latest],
        triggers: ["scope_expanded"],
        proposed_next: makeProposed({
          required_scope: { allowed_files: ["a.ts"], forbidden_files: [] },
        }),
      }),
    );
    expect(d.reason_codes).not.toContain("scope_expanded");
  });

  it("evidence_contradiction with same agent reviewer (claude → claude) → stop", () => {
    const latest = makeAttempt({ reviewer: "claude" });
    const d = evaluateRepairPolicy(
      baseInput({
        attempts: [latest],
        triggers: ["evidence_contradiction"],
        proposed_next: makeProposed({ reviewer: "claude" }),
      }),
    );
    expect(d.decision).toBe("stop_needs_human");
    expect(d.reason_codes).toContain("evidence_contradiction");
  });

  it("report_contradicts_repo_evidence: switching to static_analysis reviewer clears the stop", () => {
    const latest = makeAttempt({ reviewer: "claude" });
    const d = evaluateRepairPolicy(
      baseInput({
        attempts: [latest],
        triggers: ["report_contradicts_repo_evidence"],
        proposed_next: makeProposed({ reviewer: "static_analysis" }),
      }),
    );
    expect(d.decision).not.toBe("stop_needs_human");
  });

  it("agent_cannot_explain_root_cause: escalates model when one is available", () => {
    const latest = makeAttempt({ model: "gpt-5.3-codex" });
    const d = evaluateRepairPolicy(
      baseInput({
        attempts: [latest],
        triggers: ["agent_cannot_explain_root_cause"],
      }),
    );
    expect(d.decision).toBe("escalate_model");
    expect(d.next_model).toBe("gpt-5.5");
    expect(d.reason_codes).toContain("agent_cannot_explain_root_cause");
  });

  it("agent_cannot_explain_root_cause: forces root_cause_then_patch_plan when no model step", () => {
    const latest = makeAttempt({ model: "gpt-5.5" }); // top of codex tier
    const d = evaluateRepairPolicy(
      baseInput({
        attempts: [latest],
        triggers: ["agent_cannot_explain_root_cause"],
        proposed_next: makeProposed({ mode: "patch" }),
      }),
    );
    expect(d.decision).toBe("switch_to_diagnosis");
    expect(d.next_mode).toBe("root_cause_then_patch_plan");
  });

  it("tests_pass_but_grep_unresolved + no reviewer/mode change → stop", () => {
    const latest = makeAttempt({ reviewer: "claude", mode: "patch" });
    const d = evaluateRepairPolicy(
      baseInput({
        attempts: [latest],
        triggers: ["tests_pass_but_grep_unresolved"],
        proposed_next: makeProposed({ reviewer: "claude", mode: "patch" }),
      }),
    );
    expect(d.decision).toBe("stop_needs_human");
    expect(d.reason_codes).toContain("tests_pass_but_grep_unresolved");
  });

  it("same_class_bug_remains: escalates effort first", () => {
    const latest = makeAttempt({ effort: "medium" });
    const d = evaluateRepairPolicy(
      baseInput({
        attempts: [latest],
        triggers: ["same_class_bug_remains"],
      }),
    );
    expect(d.decision).toBe("escalate_effort");
    expect(d.next_effort).toBe("high");
  });
});

// ── §3.6 — Every decision requires human approval ────────────────────

describe("§3.6 — Human approval invariant", () => {
  it("every emitted decision has requires_human_approval === true (sweep)", () => {
    const scenarios: Array<EvaluateRepairPolicyInput> = [
      // Attempt 1 fresh
      baseInput(),
      // Failed + same-everything (escalates)
      baseInput({
        attempts: [makeAttempt({ result: "failed" })],
        proposed_next: makeProposed(),
      }),
      // Forbidden file
      baseInput({
        triggers: ["forbidden_file_touched"],
        proposed_next: makeProposed({
          required_scope: {
            allowed_files: ["src/util.ts", "src/secret.ts"],
            forbidden_files: ["src/secret.ts"],
          },
        }),
      }),
      // Max-attempts stop
      baseInput({
        attempts: [
          makeAttempt({ result: "failed", attempt_number: MAX_STRUCTURED_ATTEMPTS }),
        ],
        proposed_next: makeProposed(),
      }),
      // Variables changed
      baseInput({
        attempts: [makeAttempt({ result: "failed" })],
        proposed_next: makeProposed({ reviewer: "static_analysis" }),
      }),
    ];
    for (const s of scenarios) {
      const d = evaluateRepairPolicy(s);
      expect(d.requires_human_approval).toBe(true);
      expect(d.reason_codes.length).toBeGreaterThanOrEqual(1);
    }
  });
});

// ── No IO assumptions ────────────────────────────────────────────────

describe("No IO", () => {
  // The engine is exported as a plain function from a module with no
  // node:fs/promises (or similar) imports. The grep-style check below
  // is intentionally a runtime smoke test — if anyone ever adds an IO
  // import to src/repair_policy.ts, this test catches it.
  it("src/repair_policy.ts imports no node:fs / node:child_process", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/repair_policy.ts", "utf8");
    expect(src).not.toMatch(/from\s+["']node:fs/);
    expect(src).not.toMatch(/from\s+["']node:child_process/);
    expect(src).not.toMatch(/require\(['"]node:fs/);
  });
});
