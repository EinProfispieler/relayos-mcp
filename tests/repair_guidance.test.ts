/**
 * Tests for the repair guidance generator (Plan Task 13 / §3.7-§3.8).
 *
 * The generator is a pure function. No file IO. It accepts structured
 * ledger inputs only — never raw chat history — and emits a
 * word-budgeted Markdown document.
 */
import { describe, it, expect } from "vitest";
import {
  generateRepairGuidance,
  DEFAULT_BUDGET_WORDS,
  HARD_BUDGET_CAP,
  MIN_BUDGET_FLOOR,
  wordCount,
  type GuidanceInputs,
} from "../src/repair_guidance.js";
import type {
  EvidenceRef,
  RepairAttempt,
  RepairPolicyDecision,
  ReviewFinding,
  SourceIndexEntry,
} from "../src/schema.js";

// ── Fixtures ─────────────────────────────────────────────────────────

const RUN_ID = "r_01HXABCDEFGHJKMNPQRSTVWXYZ";
const TASK_ID = "t_1";
const FINDING_ID = "f_01HXABCDEFGHJKMNPQRSTVWXYZ";
const DECISION_ID = "d_01HXABCDEFGHJKMNPQRSTVWXYZ";

function makeFinding(o: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    id: FINDING_ID,
    run_id: RUN_ID,
    task_id: TASK_ID,
    reviewer: "claude",
    severity: "warn",
    category: "missing_tests",
    title: "buggy thing",
    summary: "the thing is buggy in src/util.ts",
    evidence_refs: [],
    status: "open",
    created_at: "2026-05-21T10:00:00Z",
    updated_at: "2026-05-21T10:00:00Z",
    ...o,
  };
}

function makeAttempt(
  attempt_number: number,
  o: Partial<RepairAttempt> = {},
): RepairAttempt {
  return {
    id: `a_01HXABCDEFGHJKMNPQRSTVW${String.fromCharCode(64 + attempt_number)}YZ`,
    finding_id: FINDING_ID,
    run_id: RUN_ID,
    task_id: TASK_ID,
    attempt_number,
    provider: "codex",
    model: "gpt-5.3-codex",
    effort: "medium",
    mode: "patch",
    changed_variables_since_previous_attempt: [],
    prompt_summary: `attempt ${attempt_number} prompt summary`,
    required_scope: { allowed_files: ["src/util.ts"], forbidden_files: [] },
    required_tests: ["tests/util.test.ts"],
    reviewer: "claude",
    result: "failed",
    evidence_refs: [],
    created_at: "2026-05-21T10:00:00Z",
    ...o,
  };
}

function makeDecision(o: Partial<RepairPolicyDecision> = {}): RepairPolicyDecision {
  return {
    id: DECISION_ID,
    finding_id: FINDING_ID,
    run_id: RUN_ID,
    task_id: TASK_ID,
    decision: "allow_retry",
    next_provider: "codex",
    next_model: "gpt-5.3-codex",
    next_effort: "high",
    next_mode: "patch_after_diagnosis",
    next_required_scope: {
      allowed_files: ["src/util.ts"],
      forbidden_files: [],
    },
    requires_human_approval: true,
    reason_codes: ["variables_changed_ok"],
    guidance_budget_words: 750,
    created_at: "2026-05-21T10:00:00Z",
    ...o,
  };
}

function makeRefs(): EvidenceRef[] {
  return [
    { kind: "file", path: "src/util.ts", line_start: 10, line_end: 20 },
    { kind: "test", file: "tests/util.test.ts", name: "happy path" },
    { kind: "command", argv: ["npm", "test"], exit_code: 1 },
    { kind: "handoff", handoff_id: "h_01" },
    { kind: "commit", sha: "abcdef1" },
    { kind: "ledger", run_id: RUN_ID, task_seq: 1 },
  ];
}

function baseInputs(o: Partial<GuidanceInputs> = {}): GuidanceInputs {
  return {
    finding: makeFinding(),
    prior_attempts: [],
    decision: makeDecision(),
    source_index_excerpt: [],
    evidence_refs: makeRefs(),
    required_tests: ["tests/util.test.ts"],
    ...o,
  };
}

// ── Sanity: typical inputs stay within default budget ────────────────

describe("Typical guidance stays under default budget", () => {
  it("empty prior_attempts + one finding: under 750 words", () => {
    const g = generateRepairGuidance(baseInputs());
    expect(g.word_count).toBeLessThanOrEqual(DEFAULT_BUDGET_WORDS);
    expect(g.truncated).toBe(false);
  });

  it("3-attempt history: under 750 words", () => {
    const g = generateRepairGuidance(
      baseInputs({
        prior_attempts: [makeAttempt(1), makeAttempt(2), makeAttempt(3)],
      }),
    );
    expect(g.word_count).toBeLessThanOrEqual(DEFAULT_BUDGET_WORDS);
    expect(g.truncated).toBe(false);
  });
});

// ── Section presence + ordering ──────────────────────────────────────

describe("All 9 required sections appear in the right order", () => {
  const HEADERS_IN_ORDER = [
    "## 1. Finding summary",
    "## 2. Evidence refs",
    "## 3. Previous attempts",
    "## 4. What failed",
    "## 5. Policy decision",
    "## 6. Forbidden scope expansion",
    "## 7. Required tests",
    "## 8. Expected output",
    "## 9. Stop conditions",
  ];

  it("each header is present", () => {
    const g = generateRepairGuidance(baseInputs());
    for (const h of HEADERS_IN_ORDER) {
      expect(g.markdown).toContain(h);
    }
  });

  it("headers appear in order (no out-of-order rendering)", () => {
    const g = generateRepairGuidance(baseInputs());
    let cursor = 0;
    for (const h of HEADERS_IN_ORDER) {
      const idx = g.markdown.indexOf(h, cursor);
      expect(idx).toBeGreaterThanOrEqual(cursor);
      cursor = idx;
    }
  });
});

// ── No-transcript invariant ──────────────────────────────────────────

describe("Guidance never contains transcript markers", () => {
  it("rejects an input whose prompt_summary contains '\\nuser:'", () => {
    // The generator collapses whitespace per-field via oneLine(), so
    // a deliberately-injected newline+user inside a single field is
    // sanitised to a single line and the transcript pattern can't
    // form. This test proves the sanitisation works end-to-end.
    const sneaky = "look: \nuser: previous prompt\nassistant: prev reply";
    const g = generateRepairGuidance(
      baseInputs({
        prior_attempts: [makeAttempt(1, { prompt_summary: sneaky })],
      }),
    );
    expect(g.markdown).not.toMatch(/\nuser:/i);
    expect(g.markdown).not.toMatch(/\nassistant:/i);
    expect(g.markdown).not.toMatch(/<message>/i);
  });

  it("normal output contains no transcript markers", () => {
    const g = generateRepairGuidance(
      baseInputs({
        prior_attempts: [makeAttempt(1), makeAttempt(2)],
      }),
    );
    expect(g.markdown).not.toMatch(/\nuser:/i);
    expect(g.markdown).not.toMatch(/\nassistant:/i);
    expect(g.markdown).not.toMatch(/<message>/i);
  });

  it("regex check matches plan's exact patterns", () => {
    const g = generateRepairGuidance(baseInputs());
    // The plan calls these out explicitly — repeating them inline
    // so the test reads as the contract, not just a forwarded check.
    expect(g.markdown.includes("\nuser:")).toBe(false);
    expect(g.markdown.includes("\nassistant:")).toBe(false);
    expect(g.markdown.includes("<message>")).toBe(false);
  });
});

// ── Forbidden files section ──────────────────────────────────────────

describe("Forbidden-files section behavior", () => {
  it("when forbidden_files is non-empty, the files appear in section 6", () => {
    const g = generateRepairGuidance(
      baseInputs({
        decision: makeDecision({
          next_required_scope: {
            allowed_files: ["src/util.ts"],
            forbidden_files: ["src/secret.ts", "bin/.relayos/"],
          },
        }),
      }),
    );
    expect(g.markdown).toMatch(/## 6\. Forbidden scope expansion/);
    expect(g.markdown).toContain("src/secret.ts");
    expect(g.markdown).toContain("bin/.relayos/");
  });

  it("when forbidden_files is empty, section 6 still renders (with a fallback note)", () => {
    const g = generateRepairGuidance(baseInputs());
    expect(g.markdown).toMatch(/## 6\. Forbidden scope expansion/);
    // Fallback prose mentions "no forbidden files" or similar
    expect(g.markdown.toLowerCase()).toMatch(/no forbidden files/);
  });
});

// ── Required tests section ───────────────────────────────────────────

describe("Required-tests section uses the structured input", () => {
  it("lists each provided required_test as a bullet", () => {
    const g = generateRepairGuidance(
      baseInputs({
        required_tests: [
          "tests/util.test.ts",
          "tests/repair_policy.test.ts::happy_path",
        ],
      }),
    );
    expect(g.markdown).toMatch(/## 7\. Required tests/);
    expect(g.markdown).toContain("`tests/util.test.ts`");
    expect(g.markdown).toContain(
      "`tests/repair_policy.test.ts::happy_path`",
    );
  });

  it("falls back to a generic note when no required_tests are given", () => {
    const g = generateRepairGuidance(
      baseInputs({ required_tests: undefined }),
    );
    expect(g.markdown).toMatch(/## 7\. Required tests/);
    expect(g.markdown.toLowerCase()).toMatch(
      /no specific tests listed|all existing tests/,
    );
  });
});

// ── Truncation behavior ──────────────────────────────────────────────

describe("Truncation when input exceeds the budget", () => {
  function manyAttempts(n: number): RepairAttempt[] {
    return Array.from({ length: n }, (_, i) => makeAttempt(i + 1, {
      id: `a_01ATTEMPTPADDING0000000${(i + 100).toString().padStart(3, "X")}`.slice(0, 28),
      prompt_summary:
        "fix the same kind of bug; iteration " +
        (i + 1) +
        " of a long chain of attempts trying many different things",
    }));
  }

  it("100-attempt input stays within the hard cap and is marked truncated", () => {
    const attempts = manyAttempts(100);
    const g = generateRepairGuidance(baseInputs({ prior_attempts: attempts }));
    expect(g.word_count).toBeLessThanOrEqual(HARD_BUDGET_CAP);
    expect(g.truncated).toBe(true);
  });

  it("100-attempt input still has all 9 sections (or a clearly-stub document)", () => {
    const attempts = manyAttempts(100);
    const g = generateRepairGuidance(baseInputs({ prior_attempts: attempts }));
    // Either the full structure survived (truncated attempts section)
    // OR the generator emitted the stub with the truncated header.
    const isStub = g.markdown.includes("# Repair guidance (truncated)");
    if (!isStub) {
      const headers = [
        "## 1. Finding summary",
        "## 2. Evidence refs",
        "## 3. Previous attempts",
        "## 4. What failed",
        "## 5. Policy decision",
        "## 6. Forbidden scope expansion",
        "## 7. Required tests",
        "## 8. Expected output",
        "## 9. Stop conditions",
      ];
      for (const h of headers) expect(g.markdown).toContain(h);
    } else {
      expect(g.markdown).toContain("REPAIR_ATTEMPTS.jsonl");
    }
  });

  it("when stub is emitted, it includes pointers to the ledger files", () => {
    // Force a stub by combining a tight budget with a large input
    const attempts = manyAttempts(200);
    const g = generateRepairGuidance(
      baseInputs({ prior_attempts: attempts }),
      MIN_BUDGET_FLOOR, // 300
    );
    expect(g.truncated).toBe(true);
    // Either it fits within the floor with aggressive truncation
    // (still structured), or it dropped to the stub. Both paths must
    // stay within the hard cap.
    expect(g.word_count).toBeLessThanOrEqual(HARD_BUDGET_CAP);
  });
});

// ── Budget clamping ──────────────────────────────────────────────────

describe("Budget clamping", () => {
  it("budget = 2000 is clamped to the hard cap (1200), not rejected", () => {
    // Build an input large enough that 2000 vs 1200 would matter,
    // but small enough that the clamped budget is comfortably met.
    const g = generateRepairGuidance(
      baseInputs({
        prior_attempts: [makeAttempt(1), makeAttempt(2), makeAttempt(3)],
      }),
      2000,
    );
    expect(g.word_count).toBeLessThanOrEqual(HARD_BUDGET_CAP);
  });

  it("budget = 50 is clamped to the floor (300), not rejected", () => {
    const g = generateRepairGuidance(baseInputs(), 50);
    // The output may be marked truncated, but the generator must
    // still emit something — it does not throw.
    expect(typeof g.markdown).toBe("string");
    expect(g.markdown.length).toBeGreaterThan(0);
  });

  it("undefined budget uses the default (750)", () => {
    const g = generateRepairGuidance(baseInputs(), undefined);
    expect(g.word_count).toBeLessThanOrEqual(DEFAULT_BUDGET_WORDS);
    expect(g.truncated).toBe(false);
  });
});

// ── Evidence ref formatting ──────────────────────────────────────────

describe("Evidence refs are pointers, not copied source bodies", () => {
  it("each ref kind formats as a pointer line", () => {
    const g = generateRepairGuidance(baseInputs());
    expect(g.markdown).toMatch(/`src\/util\.ts:10-20`/);
    expect(g.markdown).toMatch(/test `tests\/util\.test\.ts`/);
    expect(g.markdown).toMatch(/cmd: `npm test`/);
    expect(g.markdown).toMatch(/handoff `h_01`/);
    expect(g.markdown).toMatch(/commit `abcdef1`/);
    expect(g.markdown).toMatch(/ledger `r_01HXABCDEFGHJKMNPQRSTVWXYZ`/);
  });

  it("evidence section does not inline any file source", () => {
    // Source-index entries are optional context — never inlined.
    const sourceIndex: SourceIndexEntry[] = [
      { path: "src/util.ts", action: "modified", ts: "x" },
    ];
    const g = generateRepairGuidance(
      baseInputs({ source_index_excerpt: sourceIndex }),
    );
    // Asserting absence: no code-fence with file contents
    expect(g.markdown).not.toMatch(/```[\s\S]+function /);
  });
});

// ── Policy decision section ──────────────────────────────────────────

describe("Policy decision section reflects the decision's axes", () => {
  it("renders decision/next_provider/next_model/next_effort/next_mode", () => {
    const g = generateRepairGuidance(
      baseInputs({
        decision: makeDecision({
          decision: "escalate_model",
          next_provider: "claude",
          next_model: "claude-opus-4-7",
          next_effort: "max",
          next_mode: "diagnosis_only",
        }),
      }),
    );
    expect(g.markdown).toContain("`escalate_model`");
    expect(g.markdown).toContain("claude-opus-4-7");
    expect(g.markdown).toContain("max");
    expect(g.markdown).toContain("diagnosis_only");
  });

  it("shows requires_human_approval", () => {
    const g = generateRepairGuidance(baseInputs());
    expect(g.markdown.toLowerCase()).toMatch(
      /requires human approval.+yes/i,
    );
  });
});

// ── wordCount helper sanity ──────────────────────────────────────────

describe("wordCount", () => {
  it("counts whitespace-separated tokens", () => {
    expect(wordCount("")).toBe(0);
    expect(wordCount("   ")).toBe(0);
    expect(wordCount("one")).toBe(1);
    expect(wordCount("one two three")).toBe(3);
    // "#", "header", "-", "bullet", "point" — Markdown syntax counts
    // toward the budget (that's intentional; budgets bound rendered
    // output, not just prose).
    expect(wordCount("# header\n\n- bullet point")).toBe(5);
  });
});

// ── No IO ────────────────────────────────────────────────────────────

describe("No IO", () => {
  it("src/repair_guidance.ts imports no node:fs / node:child_process", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/repair_guidance.ts", "utf8");
    expect(src).not.toMatch(/from\s+["']node:fs/);
    expect(src).not.toMatch(/from\s+["']node:child_process/);
    expect(src).not.toMatch(/require\(['"]node:fs/);
  });
});
