/**
 * Repair policy engine — Plan §3 (Task 12).
 *
 * Pure function. No IO. No Python. No agent dispatch. No CLI/MCP
 * surface. Takes structured ledger objects and returns a
 * `RepairPolicyDecision`.
 *
 * Trigger precedence (Plan §10 Q8): triggers → ladder → variable-change.
 * The engine checks them in that order and returns at the first
 * decisive rule.
 *
 * Variable-change rule (Plan §3.2): a failed attempt may continue only
 * if at least one of the seven `RepairVariableChange` axes differs
 * between the proposed next attempt and the most recent attempt.
 * Schema-level parsing of a same-everything record still succeeds
 * (recovery protocol §6 needs tolerant reads); this is where the rule
 * is actually enforced.
 *
 * Human approval (Plan §3.6): every decision emitted in this batch has
 * `requires_human_approval = true`. The plan reserves the option to
 * relax this in a future revision; this revision does not.
 */
import { newRepairDecisionId } from "./id.js";
import type {
  RepairAttempt,
  RepairDecisionKind,
  RepairEffort,
  RepairMode,
  RepairPolicyDecision,
  RepairProvider,
  RepairReasonCode,
  RepairRequiredScope,
  RepairVariableChange,
  Reviewer,
  ReviewFinding,
} from "./schema.js";

// ── Input shapes ─────────────────────────────────────────────────────

export interface ProposedNextAttempt {
  provider: RepairProvider;
  model: string;
  effort: RepairEffort;
  mode: RepairMode;
  required_scope: RepairRequiredScope;
  required_tests: string[];
  reviewer: Reviewer;
}

export interface ModelLadderConfig {
  /**
   * Effort levels in ascending strength. Default
   * ["low", "medium", "high", "xhigh", "max"].
   * The engine reads "next stronger" relative to the current attempt's
   * `effort`. An empty array disables effort escalation entirely
   * (useful in tests).
   */
  effort_order: RepairEffort[];

  /**
   * Per-provider list of model identifiers in ascending strength.
   * The engine reads "next stronger model" within a provider by
   * looking up the current attempt's model in this list and stepping
   * forward by one. If the model isn't in the list, model escalation
   * for that provider is treated as "no step available".
   */
  model_tiers_by_provider: Record<RepairProvider, string[]>;

  /**
   * Optional ordering of providers to try when escalating away from
   * the current one. Defaults to `["claude", "codex", "other"]`. The
   * engine picks the next provider in this list that has at least
   * one model configured.
   */
  provider_order?: RepairProvider[];
}

export interface EvaluateRepairPolicyInput {
  finding: ReviewFinding;
  /** Chronological. The engine treats `attempts[attempts.length - 1]` as the most recent. */
  attempts: RepairAttempt[];
  proposed_next: ProposedNextAttempt;
  /** Reviewer-supplied trigger codes (Plan §3.4). Use codes, not prose. */
  triggers: RepairReasonCode[];
  ladder: ModelLadderConfig;
  /**
   * Per-decision guidance budget choice in `[300, 1200]`. Defaults to 750
   * (Plan §3.8). The schema also bounds this — values outside the
   * range are clamped.
   */
  guidance_budget_words?: number;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * The structured maximum of structured automated/semi-automated
 * repair attempts before mandatory human checkpoint (Plan §3.3).
 * "Three attempts" is a loop bound, not a permanent ceiling — a
 * human can resume by appending a new attempt directly; that path
 * is not gated by this engine.
 */
export const MAX_STRUCTURED_ATTEMPTS = 3;

/**
 * Default per-decision guidance budget (Plan §3.8). Clamped to
 * `[300, 1200]` on emit, matching `RepairPolicyDecision.guidance_budget_words`.
 */
export const DEFAULT_GUIDANCE_BUDGET_WORDS = 750;

const HARD_GUIDANCE_BUDGET_CAP = 1200;
const MIN_GUIDANCE_BUDGET_FLOOR = 300;

/** Default provider trial order when none is supplied. */
const DEFAULT_PROVIDER_ORDER: RepairProvider[] = ["claude", "codex", "other"];

/**
 * Set of triggers the engine treats as failure-pattern observations
 * about the prior attempt. They take precedence over both ladder and
 * variable-change rules — see §3.4 table.
 */
const FAILURE_TRIGGER_CODES = new Set<RepairReasonCode>([
  "test_modified_to_pass",
  "forbidden_file_touched",
  "scope_expanded",
  "evidence_contradiction",
  "report_contradicts_repo_evidence",
  "agent_cannot_explain_root_cause",
  "tests_pass_but_grep_unresolved",
  "same_class_bug_remains",
]);

/**
 * Modes that signal "diagnose, do not patch yet". Used to detect
 * whether a proposed next attempt has already moved off raw `patch`
 * mode in response to a failure-pattern trigger.
 */
const DIAGNOSIS_MODES = new Set<RepairMode>([
  "diagnosis_only",
  "patch_after_diagnosis",
  "root_cause_then_patch_plan",
]);

/** Reviewers we treat as "machine reviewers" — non-human agents. */
const AGENT_REVIEWERS = new Set<Reviewer>(["claude", "codex"]);

// ── Main entrypoint ──────────────────────────────────────────────────

/**
 * Evaluate the next step in the repair loop and return a
 * `RepairPolicyDecision`. The decision is the engine's machine
 * judgment — it never writes to disk, dispatches a handoff, or talks
 * to an agent. Callers persist the decision via the storage helpers
 * (`appendRepairDecision`) and gate dispatch on
 * `requires_human_approval` + a `UserApproval` event.
 */
export function evaluateRepairPolicy(
  input: EvaluateRepairPolicyInput,
): RepairPolicyDecision {
  const { finding, attempts, proposed_next, triggers, ladder } = input;
  const latest = attempts.length > 0 ? attempts[attempts.length - 1]! : null;
  const budget = clampGuidanceBudget(input.guidance_budget_words);
  const isFailed =
    latest !== null &&
    (latest.result === "incomplete" || latest.result === "failed");

  // ── Stage 0 — structured Attempt 3 stop boundary (wins over everything) ──
  // §3.3 / §3.5: after MAX_STRUCTURED_ATTEMPTS structured attempts,
  // if the latest is still incomplete/failed, the automated/
  // semi-automated loop ends. A human can continue by appending a
  // new RepairAttempt directly; the engine does not gate that.
  //
  // This boundary is checked BEFORE triggers, BEFORE the ladder, and
  // BEFORE the variable-change rule. Changing effort / model /
  // provider / mode / scope / tests / reviewer does NOT lift it —
  // the structured loop is over.
  if (latest !== null && latest.attempt_number >= MAX_STRUCTURED_ATTEMPTS && isFailed) {
    return decide({
      finding,
      decision: "stop_needs_human",
      proposed_next,
      reason_codes: ["max_attempts_reached"],
      budget,
    });
  }

  // ── Stage 1 — triggers (precedence above ladder + variable-change) ──
  const triggerDecision = evaluateTriggers({
    finding,
    latest,
    proposed_next,
    triggers,
    ladder,
    budget,
  });
  if (triggerDecision) return triggerDecision;

  // ── Stage 2 — fresh start, Attempt 1 ──
  if (latest === null) {
    return decide({
      finding,
      decision: "allow_retry",
      proposed_next,
      reason_codes: ["variables_changed_ok"],
      budget,
    });
  }

  // ── Stage 3 — failed-repair invariant + ladder ──
  // The Stage 0 stop already handled attempt_number >= MAX_STRUCTURED_ATTEMPTS
  // when failed/incomplete; from here we're at attempt_number < 3.
  const changedAxes = diffVariableAxes(latest, proposed_next);

  if (isFailed && changedAxes.length === 0) {
    // Same-everything retry — must escalate or stop.
    const escalation = pickEscalation({
      latest,
      ladder,
      attemptCount: latest.attempt_number,
    });
    if (escalation) {
      const overlaid: ProposedNextAttempt = {
        ...proposed_next,
        ...escalation.overlay,
      };
      return decide({
        finding,
        decision: escalation.decisionKind,
        proposed_next: overlaid,
        reason_codes: [escalation.reason, "variables_changed_ok"],
        budget,
      });
    }
    return decide({
      finding,
      decision: "stop_needs_human",
      proposed_next,
      reason_codes: [
        "same_model_effort_mode_requested",
        "no_remaining_variables_to_change",
      ],
      budget,
    });
  }

  // ── Stage 4 — variables changed; treat as a valid retry ──
  // If the latest attempt failed AND we have a real change → it's a
  // legitimate next attempt. If the latest succeeded but the caller
  // is following up anyway, also fine.
  return decide({
    finding,
    decision: "allow_retry",
    proposed_next,
    reason_codes: ["variables_changed_ok"],
    budget,
  });
}

// ── Helpers ──────────────────────────────────────────────────────────

interface DecideArgs {
  finding: ReviewFinding;
  decision: RepairDecisionKind;
  proposed_next: ProposedNextAttempt;
  reason_codes: RepairReasonCode[];
  budget: number;
}

function decide(args: DecideArgs): RepairPolicyDecision {
  const { finding, decision, proposed_next, reason_codes, budget } = args;
  return {
    id: newRepairDecisionId(),
    finding_id: finding.id,
    run_id: finding.run_id,
    task_id: finding.task_id,
    decision,
    next_provider: proposed_next.provider,
    next_model: proposed_next.model,
    next_effort: proposed_next.effort,
    next_mode: proposed_next.mode,
    next_required_scope: proposed_next.required_scope,
    // Every decision in this batch requires human approval. Plan §3.6
    // is explicit that the engine has no path to self-approve a draft
    // reply.
    requires_human_approval: true,
    reason_codes: dedupReasonCodes(reason_codes),
    guidance_budget_words: budget,
    created_at: new Date().toISOString(),
  };
}

function dedupReasonCodes(codes: RepairReasonCode[]): RepairReasonCode[] {
  // Preserve order of first occurrence — readers depend on the first
  // code being the most-specific reason.
  const seen = new Set<RepairReasonCode>();
  const out: RepairReasonCode[] = [];
  for (const c of codes) {
    if (!seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  if (out.length === 0) {
    // Defensive: the schema requires ≥ 1. Should never happen in
    // practice (every decide() call passes at least one code) but the
    // tests assert reason_codes.length >= 1 so we ensure invariant.
    out.push("variables_changed_ok");
  }
  return out;
}

function clampGuidanceBudget(requested?: number): number {
  const v =
    typeof requested === "number" && Number.isFinite(requested)
      ? Math.floor(requested)
      : DEFAULT_GUIDANCE_BUDGET_WORDS;
  if (v < MIN_GUIDANCE_BUDGET_FLOOR) return MIN_GUIDANCE_BUDGET_FLOOR;
  if (v > HARD_GUIDANCE_BUDGET_CAP) return HARD_GUIDANCE_BUDGET_CAP;
  return v;
}

// ── Variable-axis diff (Plan §3.2) ───────────────────────────────────

/**
 * Compare a proposed next attempt against the latest attempt across
 * all seven `RepairVariableChange` axes. Returns the axes that
 * differ.
 *
 * scope / tests comparisons are order-insensitive (we sort then deep-
 * compare). model / provider / effort / mode / reviewer are simple
 * string equality.
 */
export function diffVariableAxes(
  latest: RepairAttempt,
  proposed: ProposedNextAttempt,
): RepairVariableChange[] {
  const changed: RepairVariableChange[] = [];
  if (latest.provider !== proposed.provider) changed.push("provider");
  if (latest.model !== proposed.model) changed.push("model");
  if (latest.effort !== proposed.effort) changed.push("effort");
  if (latest.mode !== proposed.mode) changed.push("mode");
  if (!scopesEqual(latest.required_scope, proposed.required_scope)) {
    changed.push("scope");
  }
  if (!stringListsEqual(latest.required_tests, proposed.required_tests)) {
    changed.push("tests");
  }
  if (latest.reviewer !== proposed.reviewer) changed.push("reviewer");
  return changed;
}

function scopesEqual(a: RepairRequiredScope, b: RepairRequiredScope): boolean {
  return (
    stringListsEqual(a.allowed_files, b.allowed_files) &&
    stringListsEqual(a.forbidden_files, b.forbidden_files)
  );
}

function stringListsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] !== sb[i]) return false;
  }
  return true;
}

// ── Trigger handling (Plan §3.4) ─────────────────────────────────────

interface TriggerInput {
  finding: ReviewFinding;
  latest: RepairAttempt | null;
  proposed_next: ProposedNextAttempt;
  triggers: RepairReasonCode[];
  ladder: ModelLadderConfig;
  budget: number;
}

/**
 * Returns a decision when a trigger fires, otherwise null. The first
 * trigger that fires wins — order matters because some triggers (e.g.
 * forbidden_file_touched with overlapping scope) are unconditional
 * stops while others can be resolved by a mode change or escalation.
 */
function evaluateTriggers(input: TriggerInput): RepairPolicyDecision | null {
  const { finding, proposed_next, triggers, ladder, budget } = input;
  if (triggers.length === 0) return null;
  const trig = new Set<RepairReasonCode>(triggers);

  // 1. forbidden_file_touched: if the proposed scope still allows a
  //    file that's also in forbidden_files, stop. Otherwise force a
  //    mode change to diagnosis (don't trust patch mode without
  //    scope narrowing).
  if (trig.has("forbidden_file_touched")) {
    const allow = new Set(proposed_next.required_scope.allowed_files);
    const forbidden = proposed_next.required_scope.forbidden_files;
    const stillTouches = forbidden.some((f) => allow.has(f));
    if (stillTouches) {
      return decide({
        finding,
        decision: "stop_needs_human",
        proposed_next,
        reason_codes: ["forbidden_file_touched"],
        budget,
      });
    }
    // Proposed scope has narrowed — force diagnosis mode if not
    // already. Don't auto-clear forbidden_file_touched; mark the
    // decision as a mode switch so the agent gets diagnostic context.
    if (!DIAGNOSIS_MODES.has(proposed_next.mode)) {
      return decide({
        finding,
        decision: "switch_to_diagnosis",
        proposed_next: { ...proposed_next, mode: "diagnosis_only" },
        reason_codes: ["forbidden_file_touched"],
        budget,
      });
    }
  }

  // 2. evidence_contradiction OR report_contradicts_repo_evidence:
  //    must switch reviewer away from the agent that produced the
  //    suspect report. If the proposed reviewer is still an agent and
  //    matches the latest attempt's reviewer, stop.
  if (
    trig.has("evidence_contradiction") ||
    trig.has("report_contradicts_repo_evidence")
  ) {
    const lastReviewer = input.latest?.reviewer;
    const sameAgentReviewer =
      lastReviewer !== undefined &&
      AGENT_REVIEWERS.has(lastReviewer) &&
      proposed_next.reviewer === lastReviewer;
    if (sameAgentReviewer) {
      return decide({
        finding,
        decision: "stop_needs_human",
        proposed_next,
        reason_codes: trig.has("evidence_contradiction")
          ? ["evidence_contradiction"]
          : ["report_contradicts_repo_evidence"],
        budget,
      });
    }
  }

  // 3. scope_expanded: caller must narrow scope. If they did not
  //    (allowed_files unchanged or larger than latest's), stop.
  if (trig.has("scope_expanded") && input.latest) {
    const prev = input.latest.required_scope.allowed_files;
    const next = proposed_next.required_scope.allowed_files;
    const narrowed = next.length < prev.length;
    if (!narrowed) {
      return decide({
        finding,
        decision: "stop_needs_human",
        proposed_next,
        reason_codes: ["scope_expanded"],
        budget,
      });
    }
  }

  // 4. test_modified_to_pass: force a diagnosis-style mode. If the
  //    proposed mode is still raw patch, that's a stop.
  if (trig.has("test_modified_to_pass")) {
    if (!DIAGNOSIS_MODES.has(proposed_next.mode)) {
      return decide({
        finding,
        decision: "stop_needs_human",
        proposed_next,
        reason_codes: ["test_modified_to_pass"],
        budget,
      });
    }
    // Already in a diagnosis mode — surface as switch_to_diagnosis
    // so the decision history records the rationale.
    return decide({
      finding,
      decision: "switch_to_diagnosis",
      proposed_next,
      reason_codes: ["test_modified_to_pass"],
      budget,
    });
  }

  // 5. tests_pass_but_grep_unresolved: switch reviewer OR force
  //    diagnosis. If neither has changed, stop.
  if (trig.has("tests_pass_but_grep_unresolved") && input.latest) {
    const reviewerChanged = proposed_next.reviewer !== input.latest.reviewer;
    const modeIsDiagnosis = DIAGNOSIS_MODES.has(proposed_next.mode);
    if (!reviewerChanged && !modeIsDiagnosis) {
      return decide({
        finding,
        decision: "stop_needs_human",
        proposed_next,
        reason_codes: ["tests_pass_but_grep_unresolved"],
        budget,
      });
    }
    return decide({
      finding,
      decision: reviewerChanged ? "switch_provider" : "switch_to_diagnosis",
      proposed_next,
      reason_codes: ["tests_pass_but_grep_unresolved"],
      budget,
    });
  }

  // 6. agent_cannot_explain_root_cause: escalate model OR force
  //    root_cause_then_patch_plan.
  if (trig.has("agent_cannot_explain_root_cause") && input.latest) {
    const modelEscalation = nextModelInTier(input.latest, ladder);
    if (modelEscalation) {
      return decide({
        finding,
        decision: "escalate_model",
        proposed_next: { ...proposed_next, model: modelEscalation },
        reason_codes: ["agent_cannot_explain_root_cause"],
        budget,
      });
    }
    if (proposed_next.mode !== "root_cause_then_patch_plan") {
      return decide({
        finding,
        decision: "switch_to_diagnosis",
        proposed_next: { ...proposed_next, mode: "root_cause_then_patch_plan" },
        reason_codes: ["agent_cannot_explain_root_cause"],
        budget,
      });
    }
    return decide({
      finding,
      decision: "stop_needs_human",
      proposed_next,
      reason_codes: ["agent_cannot_explain_root_cause"],
      budget,
    });
  }

  // 7. same_class_bug_remains: escalate effort first, then model,
  //    then stop.
  if (trig.has("same_class_bug_remains") && input.latest) {
    const effortEsc = nextEffort(input.latest.effort, ladder);
    if (effortEsc) {
      return decide({
        finding,
        decision: "escalate_effort",
        proposed_next: { ...proposed_next, effort: effortEsc },
        reason_codes: ["same_class_bug_remains"],
        budget,
      });
    }
    const modelEsc = nextModelInTier(input.latest, ladder);
    if (modelEsc) {
      return decide({
        finding,
        decision: "escalate_model",
        proposed_next: { ...proposed_next, model: modelEsc },
        reason_codes: ["same_class_bug_remains"],
        budget,
      });
    }
    return decide({
      finding,
      decision: "stop_needs_human",
      proposed_next,
      reason_codes: ["same_class_bug_remains", "no_remaining_variables_to_change"],
      budget,
    });
  }

  // No deterministic trigger fired (or only failure codes that don't
  // unilaterally force a stop).
  void FAILURE_TRIGGER_CODES;
  return null;
}

// ── Ladder (Plan §3.3) ───────────────────────────────────────────────

interface LadderEscalation {
  decisionKind: RepairDecisionKind;
  reason: RepairReasonCode;
  /**
   * If set, the engine rewrites the caller's `proposed_next` with this
   * axis change before emitting the decision (so the persisted
   * decision carries the engine's recommended next setting, not the
   * caller's same-everything one). When undefined, the caller's
   * `proposed_next` is used as-is — the decision_kind alone tells the
   * caller what to do.
   */
  overlay?: Partial<ProposedNextAttempt>;
}

interface PickEscalationInput {
  latest: RepairAttempt;
  ladder: ModelLadderConfig;
  attemptCount: number;
}

/**
 * Pick the next escalation step when the caller proposed a
 * same-everything retry after a failed attempt. Tries (in order):
 *   1. effort escalation within the same model/provider
 *   2. model escalation within the same provider
 *   3. provider switch (only at attempt_count ≥ 2)
 * Returns null when no ladder step is available.
 */
function pickEscalation(input: PickEscalationInput): LadderEscalation | null {
  const { latest, ladder, attemptCount } = input;

  // Effort escalation — preferred for Attempt 2.
  const eff = nextEffort(latest.effort, ladder);
  if (eff) {
    return {
      decisionKind: "escalate_effort",
      reason: "escalation_ladder_step_available",
      overlay: { effort: eff },
    };
  }

  // Model escalation within provider — preferred for Attempt 3.
  const mdl = nextModelInTier(latest, ladder);
  if (mdl) {
    return {
      decisionKind: "escalate_model",
      reason: "escalation_ladder_step_available",
      overlay: { model: mdl },
    };
  }

  // Provider switch — only after a model-tier exhaust AND at least
  // attempt 2 of the same finding.
  if (attemptCount >= 2) {
    const nextProv = nextProvider(latest.provider, ladder);
    if (nextProv) {
      const tier = ladder.model_tiers_by_provider[nextProv];
      const firstModel = tier?.[0];
      return {
        decisionKind: "switch_provider",
        reason: "escalation_ladder_step_available",
        overlay: firstModel
          ? { provider: nextProv, model: firstModel }
          : { provider: nextProv },
      };
    }
  }
  return null;
}

function nextEffort(
  current: RepairEffort,
  ladder: ModelLadderConfig,
): RepairEffort | null {
  const order = ladder.effort_order;
  if (order.length === 0) return null;
  const i = order.indexOf(current);
  if (i < 0 || i >= order.length - 1) return null;
  return order[i + 1] ?? null;
}

function nextModelInTier(
  latest: RepairAttempt,
  ladder: ModelLadderConfig,
): string | null {
  const tier = ladder.model_tiers_by_provider[latest.provider];
  if (!tier || tier.length === 0) return null;
  const i = tier.indexOf(latest.model);
  if (i < 0 || i >= tier.length - 1) return null;
  return tier[i + 1] ?? null;
}

function nextProvider(
  current: RepairProvider,
  ladder: ModelLadderConfig,
): RepairProvider | null {
  // Scan ALL providers in the configured order (skipping `current`)
  // and return the first one with a non-empty model tier. This makes
  // `switch_provider` symmetric — exhausting codex falls through to
  // claude even though claude is earlier in the default order.
  const order = ladder.provider_order ?? DEFAULT_PROVIDER_ORDER;
  for (const p of order) {
    if (p === current) continue;
    const tier = ladder.model_tiers_by_provider[p];
    if (tier && tier.length > 0) return p;
  }
  return null;
}
