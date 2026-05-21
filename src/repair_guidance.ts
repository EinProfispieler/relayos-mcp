/**
 * Repair guidance generator — Plan §3.7 / §3.8 (Task 13).
 *
 * Pure function. No IO. Renders a compact `REPAIR_GUIDANCE.md` from
 * structured ledger inputs — never from raw chat history.
 *
 * Output contract (§3.8):
 *   • 9 required sections in a fixed order
 *   • per-section soft caps
 *   • overall default budget 750 words; hard cap 1,200
 *   • if natural rendering exceeds the budget, truncate
 *     "Previous attempts" (section 3) and "What failed" (section 4)
 *     first; sections 1, 2, 5, 6, 7, 8, 9 are never truncated
 *   • if still over after truncation, emit a compact stub (≤ 200
 *     words) pointing back to the ledger and set `truncated = true`
 *   • never inline raw prompts/replies (uses `prompt_summary` only)
 *
 * Over-large requested budgets are CLAMPED to the hard cap (1200),
 * not rejected. Under-floor budgets are clamped to 300.
 */
import type {
  EvidenceRef,
  RepairAttempt,
  RepairPolicyDecision,
  RepairReasonCode,
  ReviewFinding,
  SourceIndexEntry,
} from "./schema.js";

// ── Public API ───────────────────────────────────────────────────────

export interface GuidanceInputs {
  finding: ReviewFinding;
  /** Chronological. The generator renders these in order, oldest first. */
  prior_attempts: RepairAttempt[];
  decision: RepairPolicyDecision;
  /** Files touched in this finding's scope. Used for context, not inlined as bodies. */
  source_index_excerpt: SourceIndexEntry[];
  /** Evidence refs to surface in section 2. Pointers only — no inlined source. */
  evidence_refs: EvidenceRef[];
  /**
   * Optional explicit lists for sections 7 and 8. When omitted the
   * generator falls back to:
   *   • required_tests: `decision.next_required_scope` is not the
   *     right field for this; we instead derive from the attempt that
   *     would follow the decision. Callers that have a specific test
   *     list should pass it explicitly.
   *   • expected_output: a generic "all required tests pass" stub.
   */
  required_tests?: string[];
  expected_output?: string;
  /**
   * Optional stop-condition narrative for section 9. Defaults to a
   * generic sentence; callers can override with a task-specific
   * formulation when one exists.
   */
  stop_conditions?: string;
}

export interface GeneratedGuidance {
  markdown: string;
  word_count: number;
  /** True when sections 3/4 were trimmed OR a stub was emitted instead. */
  truncated: boolean;
}

// ── Constraints (Plan §3.8) ──────────────────────────────────────────

export const DEFAULT_BUDGET_WORDS = 750;
export const HARD_BUDGET_CAP = 1200;
export const MIN_BUDGET_FLOOR = 300;

/**
 * Per-section soft caps (§3.8). The generator targets these by
 * truncating bullets inside sections 3 and 4; sections 1, 2, 5–9 are
 * generated within their caps by construction (the fields they
 * render are already bounded by Zod schema caps).
 */
const SECTION_BUDGETS = {
  finding_summary: 120,
  evidence_refs: 100,
  previous_attempts: 250,
  what_failed: 120,
  policy_decision: 60,
  forbidden_scope: 60,
  required_tests: 80,
  expected_output: 60,
  stop_conditions: 60,
} as const;

const STUB_HARD_CAP = 200;

/**
 * Strings we treat as evidence of a raw conversation transcript.
 * If any of these patterns appear in the rendered markdown the
 * generator throws — the §3.7 contract is "structured ledger
 * objects only, never chat history".
 */
const TRANSCRIPT_PATTERNS: RegExp[] = [
  /\nuser:/i,
  /\nassistant:/i,
  /<message>/i,
];

// ── Reason code → human sentence (§3.4/§3.5) ─────────────────────────

const REASON_SENTENCES: Record<RepairReasonCode, string> = {
  // failure-pattern codes
  same_class_bug_remains:
    "The same class of bug remains after the prior patch.",
  test_modified_to_pass:
    "A prior attempt modified a test to match broken behavior instead of fixing it.",
  scope_expanded:
    "A prior attempt expanded scope beyond the finding's allowed files.",
  forbidden_file_touched:
    "A prior attempt touched a file the policy marked as forbidden.",
  evidence_contradiction:
    "The review report contradicted repo evidence (e.g. claimed code that grep can't find).",
  agent_cannot_explain_root_cause:
    "The prior agent could not articulate a root cause when asked.",
  tests_pass_but_grep_unresolved:
    "Tests pass but static evidence (grep/lint) still shows the bug.",
  report_contradicts_repo_evidence:
    "The review report's claims do not match the repo's actual state.",
  same_model_effort_mode_requested:
    "The caller proposed an identical (provider, model, effort, mode) retry.",
  // exhaustion codes
  max_attempts_reached:
    "The structured automated-loop bound (3 attempts) has been reached.",
  no_remaining_variables_to_change:
    "No further RepairVariableChange axis is available to differentiate the next attempt.",
  // success codes
  variables_changed_ok:
    "At least one RepairVariableChange axis differs from the prior attempt.",
  escalation_ladder_step_available:
    "A ladder step (effort, model, or provider) is available for escalation.",
};

// ── Public entrypoint ────────────────────────────────────────────────

export function generateRepairGuidance(
  inputs: GuidanceInputs,
  budgetWords?: number,
): GeneratedGuidance {
  const budget = clampBudget(budgetWords);

  // First render — natural, full content. If under budget we're done.
  let markdown = renderFull(inputs, /* attemptsLimit */ inputs.prior_attempts.length);
  let words = wordCount(markdown);
  let truncated = false;

  if (words <= budget) {
    enforceNoTranscript(markdown);
    return { markdown, word_count: words, truncated: false };
  }

  // Over budget — trim section 3 (Previous attempts) first by
  // limiting attempts to a smaller window, then section 4
  // (What failed) by limiting reason-code expansions.
  truncated = true;
  const attemptLimits = [10, 5, 3, 2, 1];
  for (const limit of attemptLimits) {
    markdown = renderFull(inputs, limit);
    words = wordCount(markdown);
    if (words <= budget) {
      enforceNoTranscript(markdown);
      return { markdown, word_count: words, truncated };
    }
  }

  // Still over after attempt-limiting — try also truncating §4
  // reason-code sentences to one-liners.
  markdown = renderFull(inputs, 1, /* terseReasons */ true);
  words = wordCount(markdown);
  if (words <= budget) {
    enforceNoTranscript(markdown);
    return { markdown, word_count: words, truncated };
  }

  // Last resort — emit a stub.
  const stub = renderStub(inputs);
  const stubWords = wordCount(stub);
  enforceNoTranscript(stub);
  return {
    markdown: stub,
    word_count: stubWords,
    truncated: true,
  };
}

// ── Rendering ────────────────────────────────────────────────────────

function renderFull(
  inputs: GuidanceInputs,
  attemptsLimit: number,
  terseReasons = false,
): string {
  const parts: string[] = [];
  parts.push(renderHeader());
  parts.push(renderFindingSummary(inputs.finding));
  parts.push(renderEvidenceRefs(inputs.evidence_refs));
  parts.push(renderPreviousAttempts(inputs.prior_attempts, attemptsLimit));
  parts.push(renderWhatFailed(inputs.decision, terseReasons));
  parts.push(renderPolicyDecision(inputs.decision));
  parts.push(renderForbiddenScope(inputs.decision));
  parts.push(renderRequiredTests(inputs));
  parts.push(renderExpectedOutput(inputs));
  parts.push(renderStopConditions(inputs));
  return parts.join("\n").trim() + "\n";
}

function renderHeader(): string {
  return `# Repair guidance\n`;
}

// ── Section 1 — Finding summary (≤ 120 words) ────────────────────────
function renderFindingSummary(f: ReviewFinding): string {
  const lines: string[] = [];
  lines.push(`## 1. Finding summary`);
  lines.push("");
  lines.push(`- **Title:** ${oneLine(f.title)}`);
  lines.push(`- **Severity:** ${f.severity}`);
  lines.push(`- **Category:** ${f.category}`);
  lines.push(`- **Reviewer:** ${f.reviewer}`);
  lines.push("");
  if (f.summary) {
    lines.push(truncateWords(oneLine(f.summary), SECTION_BUDGETS.finding_summary - 30));
  }
  lines.push("");
  return lines.join("\n");
}

// ── Section 2 — Evidence refs (≤ 100 words) ──────────────────────────
function renderEvidenceRefs(refs: EvidenceRef[]): string {
  const lines: string[] = [];
  lines.push(`## 2. Evidence refs`);
  lines.push("");
  if (refs.length === 0) {
    lines.push(`- _(no evidence refs recorded)_`);
    lines.push("");
    return lines.join("\n");
  }
  for (const r of refs) {
    lines.push(`- ${formatEvidenceRef(r)}`);
  }
  lines.push("");
  return lines.join("\n");
}

function formatEvidenceRef(ref: EvidenceRef): string {
  switch (ref.kind) {
    case "file": {
      const range =
        ref.line_start !== undefined && ref.line_end !== undefined
          ? `:${ref.line_start}-${ref.line_end}`
          : ref.line_start !== undefined
            ? `:${ref.line_start}`
            : "";
      return `\`${ref.path}${range}\``;
    }
    case "test":
      return ref.name
        ? `test \`${ref.file}\` → ${oneLine(ref.name)}`
        : `test \`${ref.file}\``;
    case "command": {
      const argv = ref.argv.map((a) => oneLine(a)).join(" ");
      const exit =
        ref.exit_code !== undefined ? ` (exit ${ref.exit_code})` : "";
      return `cmd: \`${argv}\`${exit}`;
    }
    case "handoff":
      return `handoff \`${ref.handoff_id}\``;
    case "commit":
      return `commit \`${ref.sha}\``;
    case "ledger":
      return ref.task_seq !== undefined
        ? `ledger \`${ref.run_id}\` task seq=${ref.task_seq}`
        : `ledger \`${ref.run_id}\``;
  }
}

// ── Section 3 — Previous attempts (≤ 250 words; truncatable) ─────────
function renderPreviousAttempts(
  attempts: RepairAttempt[],
  limit: number,
): string {
  const lines: string[] = [];
  lines.push(`## 3. Previous attempts`);
  lines.push("");
  if (attempts.length === 0) {
    lines.push(`- _(no prior attempts)_`);
    lines.push("");
    return lines.join("\n");
  }
  const start = Math.max(0, attempts.length - limit);
  const skipped = start;
  if (skipped > 0) {
    lines.push(`- _(${skipped} older attempt${skipped === 1 ? "" : "s"} truncated; see REPAIR_ATTEMPTS.jsonl for the full history)_`);
  }
  for (let i = start; i < attempts.length; i++) {
    const a = attempts[i]!;
    lines.push(renderAttemptBullet(a));
  }
  lines.push("");
  return lines.join("\n");
}

function renderAttemptBullet(a: RepairAttempt): string {
  const parts: string[] = [];
  parts.push(
    `- **#${a.attempt_number}** ${a.provider}/${a.model}/${a.effort}/${a.mode} → \`${a.result}\``,
  );
  if (a.escalation_reason) {
    parts.push(`  - escalation reason: ${oneLine(a.escalation_reason)}`);
  }
  // prompt_summary is the only prompt-related field we ever surface
  // — never the raw prompt or raw reply.
  parts.push(`  - summary: ${oneLine(a.prompt_summary)}`);
  return parts.join("\n");
}

// ── Section 4 — What failed (≤ 120 words; truncatable) ───────────────
function renderWhatFailed(
  decision: RepairPolicyDecision,
  terse: boolean,
): string {
  const lines: string[] = [];
  lines.push(`## 4. What failed`);
  lines.push("");
  if (decision.reason_codes.length === 0) {
    lines.push(`- _(no reason codes recorded on this decision)_`);
    lines.push("");
    return lines.join("\n");
  }
  for (const code of decision.reason_codes) {
    const sentence = REASON_SENTENCES[code] ?? code;
    if (terse) {
      lines.push(`- \`${code}\``);
    } else {
      lines.push(`- \`${code}\` — ${sentence}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

// ── Section 5 — Policy decision (≤ 60 words) ─────────────────────────
function renderPolicyDecision(d: RepairPolicyDecision): string {
  const lines: string[] = [];
  lines.push(`## 5. Policy decision`);
  lines.push("");
  lines.push(`- **Decision:** \`${d.decision}\``);
  if (d.next_provider) lines.push(`- **Next provider:** ${d.next_provider}`);
  if (d.next_model) lines.push(`- **Next model:** ${d.next_model}`);
  if (d.next_effort) lines.push(`- **Next effort:** ${d.next_effort}`);
  if (d.next_mode) lines.push(`- **Next mode:** ${d.next_mode}`);
  lines.push(
    `- **Requires human approval:** ${d.requires_human_approval ? "yes" : "no"}`,
  );
  lines.push("");
  return lines.join("\n");
}

// ── Section 6 — Forbidden scope expansion (≤ 60 words) ───────────────
function renderForbiddenScope(d: RepairPolicyDecision): string {
  const lines: string[] = [];
  lines.push(`## 6. Forbidden scope expansion`);
  lines.push("");
  const forbidden = d.next_required_scope?.forbidden_files ?? [];
  if (forbidden.length === 0) {
    lines.push(
      `- _(no forbidden files for this attempt — still respect existing project boundaries)_`,
    );
  } else {
    lines.push(`Do NOT touch:`);
    for (const f of forbidden) {
      lines.push(`- \`${f}\``);
    }
  }
  lines.push("");
  return lines.join("\n");
}

// ── Section 7 — Required tests (≤ 80 words) ──────────────────────────
function renderRequiredTests(inputs: GuidanceInputs): string {
  const lines: string[] = [];
  lines.push(`## 7. Required tests`);
  lines.push("");
  const tests = inputs.required_tests ?? [];
  if (tests.length === 0) {
    lines.push(
      `- _(no specific tests listed — all existing tests must continue to pass)_`,
    );
  } else {
    lines.push(`Each of the following must pass before declaring \`fixed\`:`);
    for (const t of tests) {
      lines.push(`- \`${t}\``);
    }
  }
  lines.push("");
  return lines.join("\n");
}

// ── Section 8 — Expected output (≤ 60 words) ─────────────────────────
function renderExpectedOutput(inputs: GuidanceInputs): string {
  const lines: string[] = [];
  lines.push(`## 8. Expected output`);
  lines.push("");
  const stmt =
    inputs.expected_output ??
    `The patch addresses the finding above, no scope expansion, every required test passes, and the repair is summarised in a new \`RepairAttempt\` record with \`result: "fixed"\`.`;
  lines.push(oneLine(stmt));
  lines.push("");
  return lines.join("\n");
}

// ── Section 9 — Stop conditions (≤ 60 words) ─────────────────────────
function renderStopConditions(inputs: GuidanceInputs): string {
  const lines: string[] = [];
  lines.push(`## 9. Stop conditions`);
  lines.push("");
  const stmt =
    inputs.stop_conditions ??
    `Stop and surface \`needs_human_intervention\` if: a forbidden file would be touched, a test would be modified to match broken behavior, scope expands beyond \`next_required_scope\`, or the agent cannot articulate the root cause.`;
  lines.push(oneLine(stmt));
  lines.push("");
  return lines.join("\n");
}

// ── Stub (last resort) ───────────────────────────────────────────────

function renderStub(inputs: GuidanceInputs): string {
  // Bounded to ≤ STUB_HARD_CAP (200) words. Points the next agent at
  // the ledger files where the full state lives.
  const f = inputs.finding;
  const d = inputs.decision;
  const lines: string[] = [];
  lines.push(`# Repair guidance (truncated)`);
  lines.push("");
  lines.push(
    `Full state did not fit the requested budget. Read the ledger files directly:`,
  );
  lines.push("");
  lines.push(
    `- Finding: \`runs/${f.run_id}/tasks/${f.task_id}/REVIEW_FINDINGS.jsonl\` (id=\`${f.id}\`)`,
  );
  lines.push(
    `- Attempts: \`runs/${f.run_id}/tasks/${f.task_id}/REPAIR_ATTEMPTS.jsonl\` (finding_id=\`${f.id}\`)`,
  );
  lines.push(
    `- Decision: \`runs/${f.run_id}/tasks/${f.task_id}/REPAIR_DECISIONS.jsonl\` (id=\`${d.id}\`)`,
  );
  lines.push("");
  lines.push(`Decision: \`${d.decision}\` — ${d.reason_codes.join(", ")}.`);
  lines.push(`Requires human approval: ${d.requires_human_approval ? "yes" : "no"}.`);
  lines.push("");
  return lines.join("\n");
}

// ── Helpers ──────────────────────────────────────────────────────────

function clampBudget(requested?: number): number {
  if (typeof requested !== "number" || !Number.isFinite(requested)) {
    return DEFAULT_BUDGET_WORDS;
  }
  const v = Math.floor(requested);
  if (v < MIN_BUDGET_FLOOR) return MIN_BUDGET_FLOOR;
  if (v > HARD_BUDGET_CAP) return HARD_BUDGET_CAP;
  return v;
}

export function wordCount(s: string): number {
  // A "word" is a maximal run of non-whitespace characters. Markdown
  // syntax like `# ` and `- ` counts as a word — that's intentional;
  // the budget should bound the rendered output, not the prose alone.
  const trimmed = s.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

function oneLine(s: string): string {
  // Collapse newlines so a single field can't introduce a "\nuser:"
  // pattern that the transcript check would later trip on.
  return s.replace(/\s+/g, " ").trim();
}

function truncateWords(s: string, maxWords: number): string {
  const words = s.split(/\s+/);
  if (words.length <= maxWords) return s;
  return words.slice(0, maxWords).join(" ") + " …";
}

function enforceNoTranscript(markdown: string): void {
  for (const pat of TRANSCRIPT_PATTERNS) {
    if (pat.test(markdown)) {
      throw new Error(
        `Repair guidance contained a transcript marker matching ${pat}; refusing to emit. ` +
          `Use prompt_summary / evidence_refs instead of inlining raw prompts or replies.`,
      );
    }
  }
}

// ── Re-export the source index type for callers' convenience ─────────
export type { SourceIndexEntry };
