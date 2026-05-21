# Repair Escalation Policy

> **Status:** Human contract. **Source of truth at runtime:** [`src/repair_policy.ts`](../../src/repair_policy.ts).
> If this document and the engine disagree, the engine is what RelayOS executes — file an issue.
> Companion design doc: [`docs/superpowers/plans/2026-05-20-run-ledger-continuity-layer.md`](../superpowers/plans/2026-05-20-run-ledger-continuity-layer.md) §3.

This is the policy RelayOS uses when a review (human, AI, static-analysis, or test-runner) produces a finding and the repair has to be attempted, escalated, or stopped. Read this once; let the engine enforce it afterwards.

---

## 1 · Why this policy exists

The failure mode this policy prevents is **endless same-model thrashing without a human checkpoint**.

Without a structured policy, a failed repair turns into a retry, which turns into another retry with the same model and effort, which turns into a third retry with a slightly different prompt — each call costing tokens, none of them changing the underlying setup. The model keeps making the same wrong guess and the human is never asked. The bill rises and the bug stays.

The policy makes three guarantees:

1. **A failed attempt cannot continue at the same `(provider, model, effort, mode, scope, tests, reviewer)` setting.** At least one of the seven variables must change, or the engine stops and asks the human.
2. **The automated/semi-automated loop has a hard ceiling of three structured attempts.** After a third failed or incomplete attempt, the engine stops regardless of what the caller would like to do next.
3. **No corrective message is sent to Claude or Codex without explicit human approval.** Every `RepairPolicyDecision` this batch emits has `requires_human_approval = true`.

These rules are checked by code, not by good intentions. See [§8 · What enforces this](#8--what-enforces-this).

---

## 2 · Variable-change rule

> **A failed repair attempt may continue only if at least one variable changes between attempts.**

The set of "variables" is finite and is exactly the `RepairVariableChange` union from the schema (`src/schema.ts` §2.9):

```
effort | model | provider | mode | scope | tests | reviewer
```

`evaluateRepairPolicy()` checks the proposed next attempt against the most recent attempt for the same finding and rejects the case where all seven are identical with reason code `same_model_effort_mode_requested`.

Concretely, the protocol per finding is:

1. **Attempt 1** — try at the assigned task's `(provider, model, effort, mode)`. Mode defaults to `patch` or `patch_with_tests`. Narrow scope (only the files the finding implicates).
2. **If the attempt result is `incomplete` or `failed`**, the next call to `evaluateRepairPolicy()` MUST produce a decision whose proposed next attempt differs in ≥ 1 variable, OR a `stop_needs_human` decision.
3. **Loops are not allowed at the same `(provider, model, effort, mode, scope, tests, reviewer)` setting.** This is enforced by the policy engine, not by convention.

The seven axes are first-class fields on `RepairAttempt`. Scope and test comparisons are order-insensitive — sorting `allowed_files` differently between two attempts does not count as a change.

---

## 3 · Model / effort escalation ladder

The ladder is a **default**, not a vendor lock-in. Concrete model names are listed as starting points; the policy engine reads from a small `ModelLadderConfig` table so models can be swapped without code changes.

| Step | Trigger | Default move |
|---|---|---|
| **Attempt 1** | first try after finding opens | starting `(provider, model, effort, mode)` from the task |
| **Attempt 2** | Attempt 1 = `incomplete` or `failed` | **escalate effort within the same provider**, OR switch to `patch_after_diagnosis`. Agent MUST first explain why Attempt 1 failed and enumerate exact files/lines before patching. Examples (defaults — overridable):<br>• `codex / gpt-5.3-codex / medium` → `codex / gpt-5.3-codex / high` or `xhigh`<br>• `claude / sonnet / medium` → `claude / sonnet / high` or `max` |
| **Attempt 3** | Attempt 2 = `incomplete` or `failed` | **escalate model**, possibly **switch provider** if a vendor blind spot is suspected, and force `diagnosis_only` or `root_cause_then_patch_plan` before any further edits. Human approval required before sending. Examples (defaults — overridable):<br>• `claude / sonnet / max` → `claude / opus-4.7` (or highest available)<br>• `codex / gpt-5.3-codex / xhigh` → `codex / gpt-5.5` (or highest available)<br>• same-vendor stuck → switch provider |
| **After Attempt 3** | still `incomplete` or `failed` | **`stop_needs_human`**. The automated/semi-automated loop ends. Finding status moves to `needs_human_intervention`. All evidence preserved in the ledger. |

**Important framing.** "Three attempts" is the **structured automated/semi-automated loop bound**, not a permanent ceiling. A human can still resume work on a finding after `stop_needs_human` — they append a new `RepairAttempt` directly. The engine does not gate human-authored attempts. The intent is to prevent endless same-model thrashing without a human checkpoint, not to declare findings forever unfixable.

The ladder progression in code (`pickEscalation()` in `src/repair_policy.ts`):

1. **Effort step within the current model** — tries `effort_order[i+1]` first.
2. **Model step within the current provider** — tries `model_tiers_by_provider[provider][i+1]`.
3. **Provider switch (only at `attempt_number ≥ 2`)** — scans the configured provider order (default `["claude", "codex", "other"]`), skipping the current provider, and picks the first OTHER provider with a non-empty model tier. This is deliberately not "scan forward only" — exhausting `codex` falls through to `claude` even though `claude` is earlier in the default order.

When the ladder has no step left in any direction, the engine emits `stop_needs_human` with reason `no_remaining_variables_to_change`.

---

## 4 · Escalation triggers

The following observations, when produced by review or by the policy engine examining ledger state, force a non-`allow_retry` decision (escalation, mode change, or stop). Triggers are passed in as `RepairReasonCode` strings — the engine does NOT parse prose reports.

| Trigger | Reason code | Forced action |
|---|---|---|
| Same finding remains after a patch landed | `same_class_bug_remains` | escalate effort or switch mode |
| Same class of bug appears in a nearby file | `same_class_bug_remains` | escalate model or switch mode to `root_cause_then_patch_plan` |
| Patch changed a test to match broken behavior | `test_modified_to_pass` | stop attempt, require diagnosis; human approval before next attempt |
| Review report contradicts repo evidence (e.g. claims a function exists that grep can't find) | `report_contradicts_repo_evidence` | switch reviewer or run `static_analysis` reviewer; never auto-retry the same reviewer |
| Patch expanded scope beyond the finding's allowed files | `scope_expanded` | reject, force narrower `required_scope` |
| Patch touched a forbidden / private / runtime file | `forbidden_file_touched` | reject; never retry the same agent on the same finding without scope narrowing + human approval |
| Tests pass but `grep` / static evidence still shows the bug | `tests_pass_but_grep_unresolved` | switch reviewer; switch mode to `diagnosis_only` |
| Agent cannot articulate root cause when asked | `agent_cannot_explain_root_cause` | escalate model or force `root_cause_then_patch_plan` |
| Caller proposes a repeat of the previous failed attempt at the same `(provider, model, effort, mode)` | `same_model_effort_mode_requested` | reject; require a variable change |

These triggers are evaluated by `evaluateRepairPolicy()` from structured input — not by parsing prose reports. The reviewer is responsible for emitting findings whose `category` and `evidence_refs` make the triggers detectable.

**Trigger precedence.** Triggers are checked *after* the Attempt 3 stop boundary (§5) but *before* the ladder and the variable-change rule. So an Attempt 3 with a failed/incomplete result stops on the boundary even if a trigger would otherwise force an escalation; but at attempts 1–2, a trigger like `forbidden_file_touched` can stop the loop before any ladder step is considered.

---

## 5 · Stop conditions

The policy engine emits `decision: "stop_needs_human"` when any of the following holds:

- **Attempt 3 boundary (post-fix, runtime-enforced):** `latest.attempt_number ≥ 3` AND `latest.result` is `"failed"` or `"incomplete"`. **Changes to effort, model, provider, mode, scope, tests, or reviewer do NOT lift this.** The structured automated/semi-automated loop is over.
- The proposed escalation has no remaining ladder step (no stronger model available, no higher effort, no other provider configured).
- The finding has a `forbidden_file_touched` or `evidence_contradiction` reason code AND the proposed next attempt would still touch a forbidden file (or still uses the same agent reviewer for an `evidence_contradiction` finding).
- A same-everything retry at the same `(provider, model, effort, mode, scope, tests, reviewer)` is proposed AND no ladder step is available — reason code `same_model_effort_mode_requested`.

On `stop_needs_human`, the finding's `status` moves to `needs_human_intervention`. No further automatic attempts are dispatched.

A human can override by appending a new `RepairAttempt` directly to `REPAIR_ATTEMPTS.jsonl`. The policy engine does not gate human-authored attempts — it only gates the automated/semi-automated loop. If a human appends Attempt 4 and `evaluateRepairPolicy()` is then asked about a hypothetical Attempt 5, the Attempt 3 boundary still fires; only the human can keep moving forward.

---

## 6 · Human approval is the default

Default repair flow:

```
auto-detect (reviewer)
  → auto-draft (repair_guidance generator)
  → human approval
  → send to Claude/Codex
  → append RepairAttempt result to Run Ledger
```

`RepairPolicyDecision.requires_human_approval = true` is the default and the **only** value emitted by `evaluateRepairPolicy()` in this revision. A `DraftReply` cannot move to `approval_status = "approved"` except by a human-authored `UserApproval` event (§2.13 — Plan). The transition path is: human appends `UserApproval { decision: "approved", draft_reply_id }` → the draft reply's status is updated to `"approved"` → only then may `ReplySent` be appended and the message dispatched. The policy engine never emits `UserApproval`; it has no path to.

### A future optional mode is explicitly out of scope

A future plan revision may introduce `auto_reply_policy = "safe_review_only"`. **It is not enabled today and may not be enabled without a new plan revision.** If ever introduced, it MUST enforce all of:

- only the active run and current task
- only findings whose reviewer is `static_analysis` or `test_runner` (not AI-generated review)
- no merge approval, no push, no tag, no release
- no scope expansion beyond the finding's `allowed_files`
- no new feature requests; no broad refactors
- explicit max-loop count per task
- every action appended to the ledger
- stop on any ambiguity or conflicting evidence

Until such a plan revision lands and the engine is updated to honor it, every decision keeps `requires_human_approval = true`.

---

## 7 · Token-saving requirements

The next agent or model receives a compact `REPAIR_GUIDANCE.md`, **never** a raw conversation transcript. The generator is `generateRepairGuidance()` in [`src/repair_guidance.ts`](../../src/repair_guidance.ts). Pointers, not content:

- Input is structured ledger objects (`ReviewFinding`, `RepairAttempt[]`, `RepairPolicyDecision`, `EvidenceRef[]`, `SourceIndexEntry[]`) — never chat history.
- The generator refuses to inline raw prompts or replies. Past attempts are summarised by `prompt_summary` only.
- Evidence refs (file paths with optional line ranges, test names, commands with optional exit code, handoff/commit/ledger IDs) are surfaced as pointers — file bodies are never copied into the guidance.
- The generator scans its own output for transcript markers (`\nuser:`, `\nassistant:`, `<message>`) and refuses to emit if any is present.

The word budget:

- **Default:** 750 words (`DEFAULT_GUIDANCE_BUDGET_WORDS` / `DEFAULT_BUDGET_WORDS`).
- **Hard cap:** 1,200 words. Over-large requested budgets are CLAMPED, not rejected.
- **Floor:** 300 words — below this a guidance doc cannot fit the nine required sections meaningfully.
- **Truncation priority** when natural rendering exceeds the budget: trim section 3 ("Previous attempts") first by limiting attempts to the most recent N, then trim section 4 ("What failed") to terse `code`-only bullets. If still over after both, emit a ≤ 200-word stub that points at `REVIEW_FINDINGS.jsonl` / `REPAIR_ATTEMPTS.jsonl` / `REPAIR_DECISIONS.jsonl` and sets `truncated = true`.

This is the **single concession that keeps the cost of an Attempt 2 or Attempt 3 model call from scaling with conversation length**. The cold-start cost is bounded by the guidance budget, regardless of how chatty the run has been.

For the full nine-section ordering and per-section caps, see Plan §3.8.

---

## 8 · What enforces this

The runtime enforcement is in TypeScript, not Markdown:

| Concern | File | Tests |
|---|---|---|
| Policy decisions | [`src/repair_policy.ts`](../../src/repair_policy.ts) (`evaluateRepairPolicy`, `diffVariableAxes`, `pickEscalation`, …) | [`tests/repair_policy.test.ts`](../../tests/repair_policy.test.ts) — 55 cases covering all of §2–§6 |
| Guidance generation | [`src/repair_guidance.ts`](../../src/repair_guidance.ts) (`generateRepairGuidance`, `wordCount`, transcript-marker check) | [`tests/repair_guidance.test.ts`](../../tests/repair_guidance.test.ts) — 23 cases covering §7 |
| Schemas (every shape parsed/emitted by the engine) | [`src/schema.ts`](../../src/schema.ts) (§2.8–§2.13 — Plan) | [`tests/run_ledger_schema.test.ts`](../../tests/run_ledger_schema.test.ts) |
| Storage helpers (where the records live) | [`src/run_ledger.ts`](../../src/run_ledger.ts) | [`tests/run_ledger.test.ts`](../../tests/run_ledger.test.ts) |

**This Markdown is the source of truth for intent.** The engine is the source of truth at runtime. If the two disagree, the engine wins — and the disagreement is a bug in this doc, to be fixed here.

### Deliberate divergence from the plan source

The plan's §3.5 first bullet (committed text, in `docs/superpowers/plans/2026-05-20-run-ledger-continuity-layer.md`) reads:

> *`attempt_number ≥ 3` and the next proposed move would not introduce a new variable*

The engine — and therefore this document — encodes a stricter rule (commit `2871dec`, `fix(repair): enforce attempt three stop boundary`):

> `latest.attempt_number ≥ MAX_STRUCTURED_ATTEMPTS` AND `latest.result` is `failed` or `incomplete` — **regardless of variable changes**.

The reason for the stricter rule: the variable-change loophole let a failed Attempt 3 fall through to the ladder and continue indefinitely as long as the caller bumped any axis, which defeats the structured-loop ceiling. Both `tests/repair_policy.test.ts` and this document reflect the post-fix behavior. The plan amendment that brings §3.5 in line with the code lives separately and is not committed at the time of this writing; the test suite and this Markdown are the authoritative human-readable expression of the rule.

---

## 9 · No Python

Policy logic is TypeScript only. There is no Python in the live decision path, the storage layer, or the guidance generator — adding it would split enforcement across two runtimes and double the test surface for zero benefit. Python may appear as an *ad hoc offline analysis* tool (e.g. one-off ledger archaeology by a human), but it never participates in the policy decision or the corrective message.

---

## Out of scope

- **Repair-layer CLI subcommands and MCP tools.** Deferred per Plan §9 Task 15. The policy engine, guidance generator, schemas, and storage helpers are in place; exposing them through CLI/MCP is a future plan. No CLI/MCP surface for the repair layer ships today.
- **Daemon / background process / cloud sync.** Not introduced.
- **Autonomous repair loops.** No path bypasses human approval.
- **Auto-registration of execution workspaces from `execute-handoff`.** Workspaces are always registered explicitly.
- **Automatic filesystem cleanup of merged or abandoned workspaces.** Recorded by `cleanup_policy`, never acted on by the engine.

---

## Changelog

- **2026-05-21** — Initial publication as Plan Task 14. Plan: `docs/superpowers/plans/2026-05-20-run-ledger-continuity-layer.md` §3 + Task 14. Companion commits on `feat/run-ledger-continuity`:
  - `c70a058` — schemas, IDs, task-scoped ledger helpers
  - `d7b233b` — policy engine + guidance generator
  - `2871dec` — Attempt 3 stop-boundary fix (the post-fix rule documented in §5 and §8 of this file)
