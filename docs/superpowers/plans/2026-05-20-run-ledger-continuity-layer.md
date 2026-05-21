# Run Ledger / Continuity Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent, append-only Run Ledger to RelayOS so every coding session — its tasks, handoffs, patches, and audit events — is captured in a structured, recoverable log that survives context resets and gives agents an instant, token-efficient orientation point.

**Architecture:** A "Run" is a bounded work session with a ULID-based ID stored under `.relayos/overseer/runs/`. Each Run holds a compact ledger JSONL (one record per task), a continuation packet (snapshot for resumption), a source index (files touched), and an execution-workspace registry (where work happened and who owns it). Runs are projected through read-only MCP tools and CLI subcommands; no daemon or cloud dependency is introduced.

**Tech Stack:** TypeScript, Node.js, Zod, ULID (`ulidx`), existing `src/overseer.ts` + `src/schema.ts` + `src/storage.ts` infrastructure, Vitest for tests.

---

## 1 · Current Repo Evidence

### 1.1 Risky locations

| Location | Risk |
|---|---|
| `bin/.relayos/overseer/conversation_log.jsonl` | **Tracked in git.** `.gitignore` ignores `.relayos/overseer/` but NOT `bin/.relayos/`. Private session content is committed to source history. |
| `bin/.relayos/overseer/chat_sessions.jsonl` | Same — tracked in git. |
| `.relayos/overseer/conversation_log.jsonl` | Correct location, already gitignored, safe — but `appendConversationLog()` in `src/conversation.ts:647` writes to this path only when CWD is the project root. Off-root invocations write to `bin/`. |

**Migration action required:** Move `bin/.relayos/` writes → project `.relayos/overseer/`; add `bin/.relayos/` to `.gitignore`.

### 1.2 Existing tools the Run Ledger reuses without modification

| Symbol | File | Role |
|---|---|---|
| `resolveOverseerLayout(cwd)` | `src/overseer.ts` | Canonical path resolver — returns the `OverseerLayout` struct with all known `.relayos/overseer/` paths. Run layout extends this. |
| `appendNote / appendDecision / appendHandoffResult / appendTaskRecord` | `src/overseer.ts` | Pattern for append-only JSONL writes. Run ledger follows exact same pattern. |
| `buildOverseerContextPack` | `src/overseer.ts` | Layer 3 context for agents; will read Run Ledger files when present. |
| `createAuditWriter(layout)` | `src/audit.ts` | Per-handoff audit events at `~/.claude/handoff/audit.jsonl`. Run Ledger records handoff IDs — cross-references the audit log rather than duplicating it. |
| `newHandoffId() / newCheckpointId()` | `src/id.ts` | ULID generators. Run Ledger adds `newRunId()` following exact same pattern. |
| `Envelope / TaskRecord / AuditEvent` | `src/schema.ts` | Run Ledger adds `RunRecord`, `TaskLedgerEntry`, `ContinuationPacket`, `SourceIndexEntry` to this file. |
| `write_overseer_note.ts` pattern | `src/tools/` | MCP tool pattern: Zod input schema → call append fn → return `{ ok, recorded, path }`. All new Run tools follow this. |
| `runOverseer()` dispatch table | `src/cli.ts:2887` | Switch over 30+ subcommands. New `run` subcommands added here via `case "run":` delegation. |

### 1.3 Existing subcommands confirmed absent

`overseer run`, `overseer run start`, `overseer run current`, `overseer run resume`, `overseer run compact` — none exist. The `run` keyword is unregistered in the dispatch table.

### 1.4 Related existing files under `.relayos/overseer/`

```
CURRENT_STATE.md      FORBIDDEN_ACTIONS.md  MODEL_POLICY.md
NEXT_ACTION.md        OPERATING_POLICY.md   PROJECT_BRIEF.md
chat_sessions.jsonl   conversation_log.jsonl decisions.jsonl
handoff_results.jsonl provider_cooldowns.json tasks.jsonl
timeline.jsonl        bin/  branches/  planned/
```

The Run Ledger adds a `runs/` subdirectory. Everything existing is preserved.

---

## 2 · Proposed Data Model

### 2.1 RunRecord — one per session

```typescript
// src/schema.ts — add
export interface RunRecord {
  id: string;               // "r_<ULID>"
  status: "active" | "completed" | "abandoned";
  started_at: string;       // ISO-8601
  ended_at?: string;
  goal?: string;            // one-line description set at start or first task
  branch?: string;          // git branch at start
  head_sha?: string;        // git HEAD at start
  task_count: number;       // incremented; never decremented
  handoff_ids: string[];    // all h_ IDs created during this run
}
```

Stored append-only at `.relayos/overseer/runs/r_<ULID>/run.json` (single JSON file, overwritten on status transitions — not JSONL; it is small and fully replaced on each update).

### 2.2 TaskLedgerEntry — one per task within a run

```typescript
// src/schema.ts — add
export interface TaskLedgerEntry {
  seq: number;              // 1-based within run
  task_id: string;          // matches TaskRecord.task_id if recorded
  run_id: string;
  user_input: string;
  status: "pending" | "dispatched" | "completed" | "failed" | "blocked";
  handoff_id?: string;      // h_ ID when dispatched
  target_agent?: string;
  model?: string;
  effort?: string;
  mode?: string;
  result_summary?: string;  // compact, ≤ 200 chars
  created_at: string;
  updated_at: string;
}
```

Stored append-only at `.relayos/overseer/runs/r_<ULID>/task_ledger.jsonl`. One line per entry; updates append a new line with same `seq` — last-write-wins on read (reduce by `seq`, keep highest `updated_at`).

### 2.3 ContinuationPacket — recovery snapshot

```typescript
// src/schema.ts — add
export interface ContinuationPacket {
  run_id: string;
  generated_at: string;
  context_summary: string;  // ≤ 500 chars — what we set out to do
  completed_task_ids: string[];
  pending_task_ids: string[];
  last_handoff_id?: string;
  last_handoff_status?: string;
  open_questions: string[]; // unresolved blocking questions
  next_action: string;      // one sentence
  files_modified: string[]; // from source index
  token_budget_note: string; // e.g. "compact after task 4, full history in task_ledger.jsonl"
}
```

Stored at `.relayos/overseer/runs/r_<ULID>/continuation.json` (overwritten on each compact). This is the first thing a resuming agent reads.

### 2.4 SourceIndexEntry — files touched

```typescript
// src/schema.ts — add
export interface SourceIndexEntry {
  path: string;             // repo-relative
  action: "created" | "modified" | "deleted";
  handoff_id?: string;
  task_seq?: number;
  ts: string;
}
```

Stored append-only at `.relayos/overseer/runs/r_<ULID>/source_index.jsonl`.

### 2.5 ExecutionWorkspace — where the work happened

`ExecutionWorkspace` is a **linked execution-location record**, not the feature itself. The feature remains the Run Ledger / Continuity Layer. Workspaces are recorded so audit, rollback, cleanup, and agent resume can answer: *where did this task actually run, who owned it, and is that location still valid?*

`RunRecord.branch` / `RunRecord.head_sha` capture the run's starting point on the **main** working tree. They are insufficient when:

- A task ran in a separate `git worktree` (different path, different branch, different SHA)
- Multiple agents worked in parallel checkouts owned by different processes
- A handoff applied patches in an external/sandboxed checkout (Codex or Claude)
- The user needs to clean up stale workspaces after a run ends

```typescript
// src/schema.ts — add
export interface ExecutionWorkspace {
  id: string;               // "w_<ULID>"
  run_id: string;
  task_id?: string;         // optional — workspace may span multiple tasks
  kind: "git_worktree" | "main_checkout" | "external_checkout";
  path: string;             // absolute path to the working tree root
  branch?: string;          // branch checked out in this workspace
  base_sha?: string;        // SHA the workspace was forked from (its merge base)
  head_sha?: string;        // current HEAD in the workspace (snapshot at last update)
  owner_agent: "claude" | "codex" | "human" | "other";
  purpose?: string;         // free text: "patch task 3", "review branch X", ...
  status: "active" | "merged" | "abandoned" | "cleaned";
  created_at: string;
  updated_at: string;
  cleanup_policy: "manual" | "auto_on_merge" | "auto_on_complete";
  related_handoff_id?: string;
}
```

Stored append-only at `.relayos/overseer/runs/r_<ULID>/WORKSPACES.jsonl`. Updates append new records with the same `id`; readers dedup by `id` last-write-wins on `updated_at`. The first record for an `id` is its creation; later records carry status transitions (active → merged/abandoned/cleaned).

**Why a separate registry instead of `RunRecord` fields:**

- A run can have **0..N workspaces**. The main checkout where the run started may never be the place tasks actually run (e.g., every task spawns its own `git worktree`).
- Cleanup needs per-workspace state. A run that completes successfully may leave 3 workspaces in different states: one merged, one abandoned with uncommitted work, one already cleaned.
- Audit needs ownership. `owner_agent` lets the system answer "which agent owns this dirty checkout?" without inspecting the filesystem.
- Rollback needs `base_sha` distinctly from `head_sha`. The base is the merge-point a `git checkout <base_sha>` would return to; the head is the latest snapshot in this workspace.

### 2.6 RunLayout — path resolver

```typescript
// src/run_ledger.ts — RunLayout interface and resolveRunLayout(cwd, runId).
// (Originally drafted as an addition to src/overseer.ts; landed in a
// dedicated src/run_ledger.ts module — see §9 shipped-status note for
// Task 4.)
export interface RunLayout {
  runDir: string;           // .relayos/overseer/runs/r_<ULID>/
  runJson: string;          // run.json
  taskLedger: string;       // task_ledger.jsonl
  continuation: string;     // continuation.json
  sourceIndex: string;      // source_index.jsonl
  workspaces: string;       // WORKSPACES.jsonl
}

export function resolveRunLayout(cwd: string, runId: string): RunLayout;

// Also add:
export function resolveRunsDir(cwd: string): string;
// Returns .relayos/overseer/runs/
```

### 2.7 ActiveRunPointer — which run is current

```typescript
// Stored at .relayos/overseer/active_run.json
// { run_id: "r_<ULID>" }
// Written by run start; deleted by run complete/abandon.
// read_current_run MCP tool reads this file first.
```

### 2.8 ReviewFinding — a single problem identified by review

```typescript
// src/schema.ts — add
export interface ReviewFinding {
  id: string;                          // "f_<ULID>"
  run_id: string;
  task_id: string;
  reviewer: "human" | "claude" | "codex" | "static_analysis" | "test_runner";
  severity: "info" | "warn" | "error" | "blocker";
  category:
    | "incorrect_behavior"
    | "missing_tests"
    | "test_modified_to_pass"
    | "scope_expansion"
    | "forbidden_file_touched"
    | "evidence_contradiction"
    | "regression"
    | "unexplained_change"
    | "other";
  title: string;                       // ≤ 120 chars
  summary: string;                     // ≤ 600 chars; no transcript
  evidence_refs: EvidenceRef[];        // see §2.12
  related_handoff_id?: string;
  status:
    | "open"
    | "under_repair"
    | "needs_human_intervention"
    | "resolved"
    | "wontfix";
  created_at: string;
  updated_at: string;
}
```

Stored append-only at `.relayos/overseer/runs/r_<ULID>/tasks/<task_id>/REVIEW_FINDINGS.jsonl`. Updates append new records with the same `id`; dedup last-write-wins on `updated_at`. A finding is "the unit a repair attempt targets" — exactly one finding per attempt.

### 2.9 RepairAttempt — one structured attempt to fix a finding

```typescript
// src/schema.ts — add
export type RepairMode =
  | "patch"
  | "patch_with_tests"
  | "patch_after_diagnosis"
  | "diagnosis_only"
  | "root_cause_then_patch_plan"
  | "review_only";

export type RepairResult =
  | "fixed"
  | "incomplete"
  | "failed"
  | "escalated"
  | "stopped";

export type RepairVariableChange =
  | "effort"
  | "model"
  | "provider"
  | "mode"
  | "scope"
  | "tests"
  | "reviewer";

export interface RepairAttempt {
  id: string;                          // "a_<ULID>"
  finding_id: string;
  run_id: string;
  task_id: string;
  attempt_number: number;              // 1-based, monotonically increasing per finding
  provider: "claude" | "codex" | "other";
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  mode: RepairMode;
  previous_attempt_id?: string;
  changed_variables_since_previous_attempt: RepairVariableChange[];   // empty only on attempt 1
  escalation_reason?: string;          // ≤ 240 chars; required when attempt_number > 1
  prompt_summary: string;              // ≤ 240 chars; NOT a transcript dump
  required_scope: { allowed_files: string[]; forbidden_files: string[] };  // axis: "scope"
  required_tests: string[];            // axis: "tests" — e.g. ["tests/foo.test.ts", "tests/bar.test.ts::case_x"]
  reviewer: "human" | "claude" | "codex" | "static_analysis" | "test_runner";  // axis: "reviewer"
  result: RepairResult;
  evidence_refs: EvidenceRef[];
  next_policy_decision?: string;       // forward link to RepairPolicyDecision.id
  created_at: string;
  completed_at?: string;
}
```

All seven `RepairVariableChange` axes are first-class fields on `RepairAttempt`: `provider`, `model`, `effort`, `mode`, `required_scope` (→ axis `"scope"`), `required_tests` (→ axis `"tests"`), `reviewer`. This is what makes the §3.2 rule machine-checkable — the policy engine can compare like-for-like across attempts without inferring values from prose.

Stored append-only at `.relayos/overseer/runs/r_<ULID>/tasks/<task_id>/REPAIR_ATTEMPTS.jsonl`. Dedup last-write-wins by `id`. The `attempt_number` is the durable sequence — agents and the policy engine must read it (not rely on file order).

**Invariant enforced by `evaluateRepairPolicy()` (§3):** for `attempt_number > 1`, `changed_variables_since_previous_attempt` MUST be non-empty. Same-everything retries are a policy violation, surfaced as a reason code rather than silently accepted.

### 2.10 RepairPolicyDecision — machine judgment for the next step

```typescript
// src/schema.ts — add
export type RepairDecisionKind =
  | "allow_retry"
  | "escalate_effort"
  | "escalate_model"
  | "switch_provider"
  | "switch_to_diagnosis"
  | "stop_needs_human";

export type RepairReasonCode =
  // failure-pattern codes
  | "same_class_bug_remains"
  | "test_modified_to_pass"
  | "scope_expanded"
  | "forbidden_file_touched"
  | "evidence_contradiction"
  | "agent_cannot_explain_root_cause"
  | "tests_pass_but_grep_unresolved"
  | "report_contradicts_repo_evidence"
  | "same_model_effort_mode_requested"
  // exhaustion codes
  | "max_attempts_reached"
  | "no_remaining_variables_to_change"
  // success codes
  | "variables_changed_ok"
  | "escalation_ladder_step_available";

export interface RepairPolicyDecision {
  id: string;                          // "d_<ULID>"
  finding_id: string;
  run_id: string;
  task_id: string;
  decision: RepairDecisionKind;
  next_provider?: "claude" | "codex" | "other";
  next_model?: string;
  next_effort?: "low" | "medium" | "high" | "xhigh" | "max";
  next_mode?: RepairMode;
  next_required_scope?: { allowed_files: string[]; forbidden_files: string[] };
  requires_human_approval: boolean;    // default true
  reason_codes: RepairReasonCode[];    // compact, machine-checkable; ≥ 1
  guidance_path?: string;              // relative to run dir; only set when guidance was written
  guidance_budget_words: number;       // see §3.8; default 750, hard cap 1200
  created_at: string;
}
```

Stored append-only at `.relayos/overseer/runs/r_<ULID>/tasks/<task_id>/REPAIR_DECISIONS.jsonl`; the latest decision per `finding_id` is the active one.

`reason_codes` are deliberately compact strings — the policy engine emits them instead of prose so downstream tools and tests can branch on them.

### 2.11 DraftReply — corrective message awaiting human approval

```typescript
// src/schema.ts — add
export interface DraftReply {
  id: string;                          // "dr_<ULID>"
  finding_id: string;
  run_id: string;
  task_id: string;
  target_handoff_id?: string;          // the handoff this reply will be sent against
  decision_id: string;                 // link to the RepairPolicyDecision that produced it
  body_path: string;                   // relative path to REPAIR_GUIDANCE.md (see §3.8)
  body_word_count: number;             // capped; see §3.8
  approval_status: "pending" | "approved" | "rejected" | "expired";
  approved_by?: "human";               // never auto-approved by default; see §3.6
  approved_at?: string;
  rejected_reason?: string;
  created_at: string;
}
```

Stored append-only at `.relayos/overseer/runs/r_<ULID>/tasks/<task_id>/DRAFT_REPLIES.jsonl`. Dedup last-write-wins by `id`. A reply is "approved" only when a human writes the approval — there is no path by which the policy engine self-approves (§3.6).

### 2.12 EvidenceRef — pointer to exact files/lines/commands

```typescript
// src/schema.ts — add
export type EvidenceRef =
  | { kind: "file"; path: string; line_start?: number; line_end?: number }
  | { kind: "test"; file: string; name?: string }
  | { kind: "command"; argv: string[]; exit_code?: number; output_excerpt?: string }
  | { kind: "handoff"; handoff_id: string }
  | { kind: "commit"; sha: string }
  | { kind: "ledger"; run_id: string; task_seq?: number };
```

EvidenceRefs are how findings, attempts, and policy decisions point at the **actual** code/state being discussed — not by quoting transcripts but by pointing at where the truth lives. The repair-guidance generator (§3.7) uses these refs to keep the corrective message compact.

### 2.13 Review loop event records

The review loop is recorded as structured ledger events, not as free-form chat. These records may be implemented as individual schemas or as a tagged `ReviewLoopEvent` union, but the durable event names stay stable so tools can project the history without parsing prose.

```typescript
// src/schema.ts — add in a later repair-policy batch
export interface BatchReport {
  id: string;                          // "br_<ULID>"
  run_id: string;
  task_id: string;
  source: "human" | "claude" | "codex" | "static_analysis" | "test_runner";
  summary: string;                     // ≤ 600 chars
  finding_ids: string[];
  result_id?: string;
  created_at: string;
}

export interface ReviewPass {
  id: string;                          // "rp_<ULID>"
  run_id: string;
  task_id: string;
  reviewer: "human" | "claude" | "codex" | "static_analysis" | "test_runner";
  scope: { files: string[]; commands: string[] };
  finding_ids: string[];
  evidence_refs: EvidenceRef[];
  created_at: string;
}

export interface UserApproval {
  id: string;                          // "ua_<ULID>"
  run_id: string;
  task_id: string;
  draft_reply_id: string;
  decision: "approved" | "rejected";
  note?: string;
  created_at: string;
}

export interface ReplySent {
  id: string;                          // "rs_<ULID>"
  run_id: string;
  task_id: string;
  draft_reply_id: string;
  target_handoff_id?: string;
  provider: "claude" | "codex" | "other";
  created_at: string;
}

export interface Result {
  id: string;                          // "res_<ULID>"
  run_id: string;
  task_id: string;
  finding_id?: string;
  status: "fixed" | "incomplete" | "failed" | "blocked" | "needs_human_intervention";
  summary: string;                     // ≤ 600 chars
  evidence_refs: EvidenceRef[];
  created_at: string;
}
```

Stored append-only under `.relayos/overseer/runs/r_<ULID>/tasks/<task_id>/` using event-specific JSONL files or a single tagged `REVIEW_EVENTS.jsonl`. The first implementation should prefer event-specific files only if that matches the existing helper style better; the product contract is the typed event vocabulary above.

---

## 3 · Review / Repair / Escalation Policy

The Run Ledger is an **observation surface**. This section defines the **policy** that decides what happens when review (human, AI, static, or test-runner) produces a finding — how a repair gets attempted, when to escalate, and when to stop and bring in a human.

### 3.1 Why a machine-checkable policy

A Markdown policy doc is readable but unenforceable. If the only enforcement mechanism is prose, the system relies on every agent and contributor remembering and applying the same rule. That doesn't survive context loss, model substitution, or a tired human.

The policy in this section is therefore split into **two artifacts** that must agree:

1. **Human contract** — `docs/overseer/REPAIR_ESCALATION_POLICY.md` (Markdown). Principles, examples, model ladder, scope boundaries. Read by humans. Not executed.
2. **Machine judgment** — `src/repair_policy.ts` (TypeScript). Takes structured ledger input, returns a `RepairPolicyDecision`. Exercised by tests. The CLI/MCP repair tools (deferred to a later batch) call this — there is no path that bypasses it.

If the two ever disagree, the test suite that exercises `evaluateRepairPolicy()` against documented examples must fail. The Markdown is updated to match the code, not the other way around — code is the source of truth at runtime; Markdown is the source of truth for **intent**.

**No Python.** RelayOS is TypeScript/Node. Adding Python for policy logic would add a runtime and a test surface for zero benefit, and would split enforcement across two languages. Python may be mentioned as an *ad hoc offline analysis* tool (e.g. for one-off ledger archaeology by a human), but it never participates in the live decision path.

### 3.2 Repair attempt protocol — the variable-change rule

The core rule is:

> **A failed repair attempt may continue only if at least one variable changes between attempts.**

The set of "variables" is finite and is exactly the `RepairVariableChange` union from §2.9: `effort | model | provider | mode | scope | tests | reviewer`. `evaluateRepairPolicy()` checks the proposed next attempt against the most recent attempt for the same finding and rejects the case where all seven are identical with reason code `same_model_effort_mode_requested`.

Concretely, the protocol per finding is:

1. **Attempt 1** — try at the assigned task's `(provider, model, effort, mode)`. Mode defaults to `patch` or `patch_with_tests`. Narrow scope (only the files the finding implicates).
2. **If the attempt result is `incomplete` or `failed`**, the next call to `evaluateRepairPolicy()` MUST produce a decision whose proposed next attempt differs in ≥ 1 variable, OR a `stop_needs_human` decision.
3. **Loops are not allowed at the same `(provider, model, effort, mode, scope, tests, reviewer)` setting.** This is enforced by the policy engine, not by convention.

### 3.3 Model / effort escalation ladder

The ladder is a **default**, not a vendor lock-in. Concrete model names are listed as starting points; the policy engine reads from a small config table so models can be swapped without code changes.

| Step | Trigger | Default move |
|---|---|---|
| **Attempt 1** | first try after finding opens | starting `(provider, model, effort, mode)` from the task |
| **Attempt 2** | Attempt 1 = `incomplete` or `failed` | **escalate effort within the same provider**, OR switch to `patch_after_diagnosis`. Agent MUST first explain why Attempt 1 failed and enumerate exact files/lines before patching. Examples (defaults — overridable):<br>• `codex / gpt-5.3-codex / medium` → `codex / gpt-5.3-codex / high` or `xhigh`<br>• `claude / sonnet / medium` → `claude / sonnet / high` or `max` |
| **Attempt 3** | Attempt 2 = `incomplete` or `failed` | **escalate model**, possibly **switch provider** if a vendor blind spot is suspected, and force `diagnosis_only` or `root_cause_then_patch_plan` before any further edits. Human approval required before sending. Examples (defaults — overridable):<br>• `claude / sonnet / max` → `claude / opus-4.7` (or highest available)<br>• `codex / gpt-5.3-codex / xhigh` → `codex / gpt-5.5` (or highest available)<br>• same-vendor stuck → switch provider |
| **After Attempt 3** | still `incomplete` or `failed` | **`stop_needs_human`**. The automated/semi-automated loop ends. Finding status moves to `needs_human_intervention`. All evidence preserved in the ledger. |

**Important framing.** "Three attempts" is the **structured automated/semi-automated loop bound**, not a permanent ceiling. A human can still resume work on a finding after `stop_needs_human` by appending a new `RepairAttempt` directly to `REPAIR_ATTEMPTS.jsonl` — the engine does NOT gate human-authored attempts (it only gates the automated loop). If `evaluateRepairPolicy()` is then asked about a hypothetical further attempt, the Attempt 3 boundary still fires; only the human can keep moving work forward past that point. The intent is to prevent endless same-model thrashing without a human checkpoint, not to declare findings forever unfixable.

### 3.4 Escalation triggers

The following observations, when produced by review or by the policy engine examining ledger state, force a non-`allow_retry` decision (escalation, mode change, or stop):

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

### 3.5 Stop conditions

The policy engine emits `stop_needs_human` when any of the following holds:

- **Attempt 3 boundary:** `latest.attempt_number ≥ MAX_STRUCTURED_ATTEMPTS` (3) AND `latest.result` is `"failed"` or `"incomplete"`. **Changes to effort, model, provider, mode, scope, tests, or reviewer do NOT lift this** — the structured automated/semi-automated loop is over. (This is the runtime rule in `src/repair_policy.ts`; it is stricter than an earlier draft of this section that gated the stop on "no new variable", and was fixed in commit `2871dec`.)
- the proposed escalation has no remaining ladder step (no stronger model available, no higher effort, no other provider configured)
- the finding has a `forbidden_file_touched` or `evidence_contradiction` reason code AND the proposed next attempt would still touch a forbidden file (or still uses the same agent reviewer, for `evidence_contradiction`)
- the same reason code repeats across the last two attempts (loop detection beyond simple variable-change check)

On `stop_needs_human`, the finding's `status` moves to `needs_human_intervention`. No further automatic attempts are dispatched. A human can override by appending a new `RepairAttempt` (the policy engine does not gate human-authored attempts — it only gates automated ones).

### 3.6 Human approval is the default

Default repair flow:

```
auto-detect (reviewer)
  → auto-draft (repair_guidance generator)
  → human approval
  → send to Claude/Codex
  → append RepairAttempt result to Run Ledger
```

`RepairPolicyDecision.requires_human_approval = true` is the default and the only value emitted by `evaluateRepairPolicy()` in this batch. A `DraftReply` cannot move to `approval_status = "approved"` except by a human-authored `UserApproval` event (§2.13). The transition path is: human appends `UserApproval { decision: "approved", draft_reply_id }` → the draft reply's status is updated to `"approved"` → only then may `ReplySent` be appended and the message dispatched. The policy engine never emits `UserApproval`; it has no path to.

#### Future optional mode (out of scope for this plan)

A future plan revision may introduce `auto_reply_policy = "safe_review_only"`. **If** ever introduced, it MUST enforce all of:

- only the active run and current task
- only findings whose reviewer is `static_analysis` or `test_runner` (not AI-generated review)
- no merge approval, no push, no tag, no release
- no scope expansion beyond the finding's `allowed_files`
- no new feature requests; no broad refactors
- explicit max-loop count per task
- every action appended to the ledger
- stop on any ambiguity or conflicting evidence

It is **explicitly not** part of this plan. Mentioned here only so future contributors understand the boundary if they propose adding it.

### 3.7 Token-saving guidance generator

The next agent/model receives a compact `REPAIR_GUIDANCE.md`, **never** a raw transcript dump. `src/repair_guidance.ts` produces it from structured ledger inputs:

```typescript
// src/repair_guidance.ts — shipped in commit d7b233b (Plan Task 13)
export interface GuidanceInputs {
  finding: ReviewFinding;
  prior_attempts: RepairAttempt[];         // chronological
  decision: RepairPolicyDecision;
  source_index_excerpt: SourceIndexEntry[]; // only files touched in this finding
  evidence_refs: EvidenceRef[];
}

export interface GeneratedGuidance {
  markdown: string;
  word_count: number;                       // enforced ≤ budget; see §3.8
  truncated: boolean;
}

export function generateRepairGuidance(
  inputs: GuidanceInputs,
  budgetWords: number,
): GeneratedGuidance;
```

The generator's contract:

- It receives **structured ledger objects**, not chat history.
- It refuses to emit text exceeding `budgetWords`. If the natural rendering would exceed the budget, it truncates sections in a documented priority order (see §3.8) and sets `truncated = true`.
- It never quotes raw model output. Past attempts are summarised by their `prompt_summary`, `result`, and `evidence_refs` — not by appending their full prompts or replies.
- It includes pointers (file paths, line ranges, commands) instead of inlining file contents.

This is the **single concession that keeps the cost of an Attempt 2 or Attempt 3 model call from scaling with conversation length**. The cold-start cost is bounded by the guidance budget, regardless of how chatty the run has been.

### 3.8 `REPAIR_GUIDANCE.md` format and word budget

**Path:** `.relayos/overseer/runs/<run_id>/tasks/<task_id>/REPAIR_GUIDANCE.md`

**Word budget:**
- **Default budget:** 600–900 words.
- **Hard cap:** 1,200 words. The generator MUST refuse to emit beyond this, even with explicit override. (The cap is checked by `repair_guidance.test.ts`.)
- **`guidance_budget_words` in `RepairPolicyDecision`** is the per-decision budget choice within `[300, 1200]`. Default is 750.

**Required sections (in this order):**

1. **Finding summary** (≤ 120 words) — the title + a one-paragraph summary. No transcript.
2. **Evidence refs** (≤ 100 words) — bullet list of exact file:line, test names, and commands. Pulled from `finding.evidence_refs`.
3. **Previous attempts** (≤ 250 words) — one bullet per prior `RepairAttempt`, each containing: `attempt_number`, `(provider, model, effort, mode)`, `result`, `escalation_reason` (when present), and one-line `prompt_summary`. Never the raw prompt or reply.
4. **What failed** (≤ 120 words) — the reason codes from the active `RepairPolicyDecision`, expanded to one sentence each.
5. **Policy decision** (≤ 60 words) — `decision`, `next_provider/model/effort/mode`, and `requires_human_approval`.
6. **Forbidden scope expansion** (≤ 60 words) — explicit list of files NOT to touch (from `next_required_scope.forbidden_files`).
7. **Required tests** (≤ 80 words) — tests that must pass before declaring the attempt `fixed`.
8. **Expected output** (≤ 60 words) — what counts as success for this attempt.
9. **Stop conditions** (≤ 60 words) — what would trigger `stop_needs_human` even if patches land.

**Truncation priority** (when the natural rendering exceeds budget): sections 3 (Previous attempts) and 4 (What failed) are truncated first — older attempts are summarised more tersely. Sections 1, 2, 5, 6, 7, 8, 9 are never truncated. If the document still exceeds the cap after these truncations, the generator returns `truncated = true` and writes a stub guidance file pointing at the run ledger for the missing detail.

**No raw conversation dump.** This is checked by `repair_guidance.test.ts`: any guidance output containing patterns characteristic of prompt/reply transcripts (e.g. `\nuser:`, `\nassistant:`, `<message>`) fails the test.

---

## 4 · File Layout

Run-scoped state lives under `.relayos/overseer/runs/<run_id>/`. Task-scoped state — review findings, repair attempts, policy decisions, draft replies, and guidance — lives one level deeper at `runs/<run_id>/tasks/<task_id>/`. The split keeps run-wide concerns (continuation packet, source index, workspaces) separate from per-task review state, so a long-running task does not bloat the run-level files.

```
.relayos/overseer/
  active_run.json                    # { run_id } — pointer to current run
  runs/
    r_<ULID>/
      run.json                       # RunRecord (compact JSON, replaced on update)
      task_ledger.jsonl              # TaskLedgerEntry — append-only, last-wins by seq
      continuation.json              # ContinuationPacket — replaced on compact
      source_index.jsonl             # SourceIndexEntry — append-only
      WORKSPACES.jsonl               # ExecutionWorkspace — append-only, last-wins by id
      tasks/
        <task_id>/
          TASK_LEDGER.md             # human summary, regenerated; ≤ 1,500 words
          REVIEW_FINDINGS.jsonl      # ReviewFinding — append-only, last-wins by id
          REPAIR_ATTEMPTS.jsonl      # RepairAttempt — append-only, last-wins by id
          REPAIR_DECISIONS.jsonl     # RepairPolicyDecision — append-only (latest per finding)
          DRAFT_REPLIES.jsonl        # DraftReply — append-only, last-wins by id
          REPAIR_GUIDANCE.md         # compact generated guidance, word-budgeted (§3.8)
          REVIEW_EVENTS.jsonl        # §2.13 tagged events: BatchReport, ReviewPass,
                                     # UserApproval, ReplySent, Result. Append-only.
  # existing files unchanged:
  timeline.jsonl
  decisions.jsonl
  handoff_results.jsonl
  tasks.jsonl
  conversation_log.jsonl
  chat_sessions.jsonl
  CURRENT_STATE.md  NEXT_ACTION.md  etc.

docs/
  overseer/
    REPAIR_ESCALATION_POLICY.md      # human contract (Markdown); see §3.

src/
  schema.ts          # + RunRecord, TaskLedgerEntry, ContinuationPacket,
                     #   SourceIndexEntry, ExecutionWorkspace (Batch 1, landed);
                     #   Task 10 adds: ReviewFinding, RepairAttempt,
                     #   RepairPolicyDecision, DraftReply, EvidenceRef.
  run_ledger.ts      # storage helpers. Batch 1 (landed):
                     #   resolveRunLayout, resolveRunsDir,
                     #   readActiveRunId/setActiveRunId/clearActiveRunId,
                     #   writeRunRecord/readRunRecord/listRuns,
                     #   append/readTaskLedgerEntries (dedup by seq),
                     #   write/readContinuationPacket,
                     #   append/readSourceIndexEntries,
                     #   append/readExecutionWorkspaces,
                     #   updateExecutionWorkspaceStatus.
                     # Task 11 extends with task-scoped helpers:
                     #   resolveTaskLayout(cwd, runId, taskId),
                     #   appendReviewFinding/readReviewFindings,
                     #   appendRepairAttempt/readRepairAttempts,
                     #   appendRepairDecision/readActiveRepairDecision,
                     #   appendDraftReply/readDraftReplies,
                     #   writeRepairGuidance/readRepairGuidance.
  repair_policy.ts   # Task 12 — evaluateRepairPolicy(input): RepairPolicyDecision.
                     # Pure function, no IO. TypeScript only — no Python.
                     # Tests in tests/repair_policy.test.ts.
  repair_guidance.ts # Task 13 — generateRepairGuidance(inputs, budgetWords):
                     # GeneratedGuidance. Pure function. Tests in
                     # tests/repair_guidance.test.ts (budget + no-transcript checks).
  id.ts              # + newRunId, newExecutionWorkspaceId (Batch 1, landed).
                     # Task 10 also adds: newReviewFindingId (f_),
                     # newRepairAttemptId (a_), newRepairDecisionId (d_),
                     # newDraftReplyId (dr_).
  cli.ts             # CLI subcommands for the repair layer are deferred
                     # (Task 15, separate batch). No CLI surface lands until
                     # storage + policy + guidance are reviewed.

tests/
  run_ledger.test.ts            # extended in Task 11 with task-scoped helpers
  run_ledger_schema.test.ts     # extended in Task 10 with the new schemas
  repair_policy.test.ts         # Task 12 — variable-change, ladder, stop, triggers
  repair_guidance.test.ts       # Task 13 — budget cap, no transcript, truncation
```

**`TASK_LEDGER.md`** is a human-readable summary regenerated by the policy/guidance pipeline (not a source of truth). It is bounded to 1,500 words. The source of truth for any field shown in it is the corresponding JSONL.

**Append-only discipline:**
- `task_ledger.jsonl`, `source_index.jsonl`, `WORKSPACES.jsonl` — never truncated; records only appended. Last-write-wins on read (by `seq` / by `id`).
- `run.json` and `continuation.json` — small, replaced atomically (write to `.tmp` then rename).
- `timeline.jsonl`, `decisions.jsonl`, `handoff_results.jsonl` — untouched; Run Ledger references their content by timestamp, does not duplicate.
- `active_run.json` — written on `run start`, deleted on `run complete`/`abandon`.

**Size management:**
- `task_ledger.jsonl` grows at ~300 bytes/entry. At 50 tasks/day × 30 days = ~450 KB — manageable without rotation.
- `source_index.jsonl` grows at ~100 bytes/entry. Bounded by files touched per run — typically < 1000 entries.
- `WORKSPACES.jsonl` grows at ~400 bytes/entry. Typically 1–10 workspaces per run; status transitions add 2–4 records per workspace.
- `continuation.json` is always ≤ 2 KB (capped fields). Agents read this first.
- Runs older than 30 days can be archived (moved to `runs/archive/`) via `overseer run archive`; out of scope for this plan.

---

## 5 · CLI/MCP Surface

### 5.1 CLI — `overseer run <subcommand>`

Registered in `src/cli.ts` under `case "run":` → `runOverseerRun(sub, args, cwd)`.

| Subcommand | Behavior |
|---|---|
| `overseer run start [--goal "..."]` | Create `r_<ULID>`, write `run.json` (status: active), write `active_run.json`. Prints run ID. Idempotent if active run exists — prints existing ID with notice. |
| `overseer run current` | Read `active_run.json` → print `run.json` + last 5 `task_ledger.jsonl` entries (deduped). JSON output. |
| `overseer run resume <run-id>` | Set `active_run.json` to given run ID (must exist and be non-abandoned). Reads `continuation.json` and prints it. |
| `overseer run compact` | Read current run's `task_ledger.jsonl` + `source_index.jsonl` → write `continuation.json`. Print compact summary. |
| `overseer run complete [--summary "..."]` | Set `run.json` status → `completed`, set `ended_at`, write final `continuation.json`, delete `active_run.json`. |
| `overseer run abandon` | Set `run.json` status → `abandoned`, set `ended_at`, delete `active_run.json`. |
| `overseer run list` | List all runs under `runs/` — id, status, started_at, goal, task_count. JSON array. |

All subcommands print machine-readable JSON (no pretty-print prose) when `--json` flag is set; default is human-readable one-liners. Exit code 0 on success, 1 on error.

### 5.2 MCP tools

Four new tools following the exact pattern of `src/tools/write_overseer_note.ts`:

#### `write_run_event`

```typescript
// src/tools/write_run_event.ts
const WriteRunEventInput = z.object({
  seq: z.number().int().positive(),
  user_input: z.string().min(1),
  status: z.enum(["pending","dispatched","completed","failed","blocked"]),
  handoff_id: z.string().optional(),
  target_agent: z.string().optional(),
  model: z.string().optional(),
  effort: z.string().optional(),
  mode: z.string().optional(),
  result_summary: z.string().max(200).optional(),
});
// Returns: { ok: true, run_id, seq, path }
```

Appends a `TaskLedgerEntry` to the active run's `task_ledger.jsonl`. Errors if no active run.

#### `read_current_run`

```typescript
// src/tools/read_current_run.ts
// No input required.
// Returns: { run: RunRecord, recent_tasks: TaskLedgerEntry[], continuation: ContinuationPacket | null }
// recent_tasks = last 10 entries (deduped by seq, last-wins)
```

#### `read_current_task_ledger`

```typescript
// src/tools/read_current_task_ledger.ts
const ReadCurrentTaskLedgerInput = z.object({
  last_n: z.number().int().min(1).max(100).default(20),
});
// Returns: { run_id, entries: TaskLedgerEntry[], total_lines: number }
// Deduplication: group by seq, keep entry with latest updated_at
```

#### `update_task_ledger`

```typescript
// src/tools/update_task_ledger.ts
const UpdateTaskLedgerInput = z.object({
  seq: z.number().int().positive(),
  status: z.enum(["pending","dispatched","completed","failed","blocked"]).optional(),
  handoff_id: z.string().optional(),
  result_summary: z.string().max(200).optional(),
});
// Appends a new record with same seq and updated_at = now.
// Returns: { ok: true, seq, path }
```

### 5.3 MCP tool registration

All four tools registered in `src/tools/index.ts` following the existing registration pattern. No MCP server configuration file changes needed — tools are auto-discovered by the existing registration mechanism.

---

## 6 · Agent Recovery Protocol

### 6.1 Startup sequence (what an agent reads on session start)

Order matters. Read top-to-bottom; stop early if you have enough orientation.

```
1.  .relayos/overseer/active_run.json          — is there an active run?
    → If yes, proceed to step 2.
    → If no, this is a fresh start; invoke `overseer run start`.

2.  .relayos/overseer/runs/<run_id>/continuation.json
    → Read this FIRST. It is ≤ 2 KB. It tells you: goal, completed tasks,
      pending tasks, files modified, and next_action.
    → If continuation.json is missing (run newly started), skip to step 3.

3.  .relayos/overseer/runs/<run_id>/run.json
    → Verify run is active (status = "active"). Check branch/head_sha match.

4.  .relayos/overseer/runs/<run_id>/task_ledger.jsonl  (last 10 entries)
    → Understand what was dispatched and what completed.
    → Look for any "dispatched" entries without matching "completed" — those
      are in-flight handoffs to check.

5.  .relayos/overseer/runs/<run_id>/tasks/<active_task_id>/REPAIR_GUIDANCE.md
    → If this file exists for the task you are about to act on, READ IT
      INSTEAD of the raw ledger. It is bounded to ≤ 1,200 words and
      already contains: finding summary, evidence refs, prior attempts,
      next policy decision, forbidden scope, required tests, and stop
      conditions. This is the §3.7/§3.8 contract.
    → Do NOT also pull the full REVIEW_FINDINGS.jsonl /
      REPAIR_ATTEMPTS.jsonl unless guidance.truncated = true or you
      need a specific evidence ref the guidance points at.

6.  ~/.claude/handoff/audit.jsonl  (only for in-flight handoff IDs from step 4)
    → Verify actual handoff status. Do NOT read the full audit log.

7.  .relayos/overseer/NEXT_ACTION.md  (existing file, unchanged)
    → Absolute ground truth for what to do next.

8.  Stop reading. Do not read conversation_log.jsonl.
    Do not read timeline.jsonl unless debugging.
    Do not read all of task_ledger.jsonl — only last N entries.
    Do not read raw REVIEW_FINDINGS.jsonl / REPAIR_ATTEMPTS.jsonl unless
    REPAIR_GUIDANCE.md tells you to drill into a specific id.
```

### 6.2 Token budget guidance

The continuation packet is designed to fit in 1,000 tokens. Reading steps 1–4 above uses < 3,000 tokens. The full cold-start context (all 4 layers + run ledger) should stay under 10,000 tokens for a typical in-progress run.

`buildOverseerContextPack` (Layer 3) is extended to append a "Run Ledger" section when an active run exists. The section is: run ID + goal + continuation packet summary. This is injected automatically into every conversation turn.

### 6.3 What agents skip

- `conversation_log.jsonl` — contains full message history; skip unless explicitly debugging. The continuation packet captures the semantic outcome, not the conversation.
- All `runs/` directories except the active one.
- Full `task_ledger.jsonl` beyond last-N entries.
- `source_index.jsonl` — read only when doing affected-file analysis.
- Raw `REVIEW_FINDINGS.jsonl` / `REPAIR_ATTEMPTS.jsonl` / `REPAIR_DECISIONS.jsonl` / `DRAFT_REPLIES.jsonl` — the compact `REPAIR_GUIDANCE.md` is the agent-facing surface. Drill into the JSONL only when guidance points you at a specific id, or when reconstructing audit history (§7).

---

## 7 · Audit and Rollback

### 7.1 Connecting commits, patches, handoffs, and workspaces

Each `TaskLedgerEntry` stores `handoff_id`. The existing audit log at `~/.claude/handoff/audit.jsonl` stores every event for that handoff (spawning, patch_applied, completed, etc.) via `createAuditWriter`. The `Checkpoint` stored at `~/.claude/handoff/checkpoints/c_<ULID>.json` records `git.head`, `git.branch`, `git.dirty`, and `files.diff_path`.

`ExecutionWorkspace` records (`WORKSPACES.jsonl`) close the remaining gap: they identify the **physical location** the patch was applied to and which agent owned it. A workspace links back to handoffs via `related_handoff_id` and forward to tasks via `run_id` + `task_id`.

Full cross-reference path:

```
task_ledger.jsonl[seq].handoff_id      →  h_XXX
  ↓                                    ↓
WORKSPACES.jsonl[related_handoff_id=h_XXX]   audit.jsonl[handoff_id=h_XXX]
  ↓ (path, owner_agent, base_sha,             ↓
     head_sha, status)                       checkpoints/c_YYY.json
                                              ↓
                                             git.head = <SHA>

tasks/<task_id>/REPAIR_ATTEMPTS.jsonl  →  attempts that produced h_XXX
  ↓ (attempt_number, provider, model, effort, mode, result,
     changed_variables_since_previous_attempt, escalation_reason)
  ↓ next_policy_decision → REPAIR_DECISIONS.jsonl[id=d_ZZZ]
  ↓ originating finding  → REVIEW_FINDINGS.jsonl[id=f_WWW]
```

This gives the full **where + who + what + why** picture without duplicating storage: the workspace tells you where, the handoff/audit tell you what, the repair-attempt chain tells you why this attempt was made and what variables changed from the prior one.

### 7.2 Rollback points

A rollback point is implicit at each `TaskLedgerEntry` with `status = "completed"` that has a linked `handoff_id`. The path to a usable SHA depends on whether the work happened in a workspace:

- **No workspace record** (legacy / main checkout): use the handoff's checkpoint `git.head`.
- **Workspace record present**: prefer the workspace's `base_sha` (the merge-base before the workspace diverged) for "undo this whole workspace", or the workspace's `head_sha` for "restore to this workspace's last known state".

```bash
# Roll back to before task N+1's workspace was created:
#   task_ledger.jsonl → handoff_id h_XXX
#   WORKSPACES.jsonl  → related_handoff_id=h_XXX → base_sha=<SHA>
git checkout <SHA>

# OR restore to the workspace's last committed state:
#   WORKSPACES.jsonl  → related_handoff_id=h_XXX → head_sha=<SHA>
git checkout <SHA>

# Fallback (no workspace record):
#   checkpoints/c_YYY.json → git.head=<SHA>
git checkout <SHA>
```

The `overseer run` CLI does not automate this — it surfaces SHAs and workspace paths. Actual `git checkout` and `git worktree remove` remain the user's action.

### 7.3 Workspace cleanup

When a run completes or is abandoned, `WORKSPACES.jsonl` is the source of truth for what physical state needs cleaning up:

- `status = "merged"` + `cleanup_policy = "auto_on_merge"` → safe to `git worktree remove <path>`
- `status = "active"` at run completion → user must decide: merge, abandon, or leave for next run
- `status = "abandoned"` → workspace path may still contain uncommitted work; cleanup requires explicit user confirmation
- `status = "cleaned"` → record retained for audit; filesystem already cleared

The CLI surfaces these states via `overseer run current` (active workspaces section) and `overseer run list-workspaces <run-id>`. **Automated cleanup is out of scope for this plan** — `cleanup_policy` is captured but not acted on. A follow-on can add `overseer workspace cleanup --auto` once the surfacing tools are proven.

### 7.4 Keeping private logs out of git

**Immediate action (part of Task 1 below):** Add `bin/.relayos/` to `.gitignore`. This prevents future commits of `bin/.relayos/overseer/conversation_log.jsonl` and `bin/.relayos/overseer/chat_sessions.jsonl`. The already-committed versions in git history remain (no rewrite of history).

**Long-term:** `appendConversationLog()` in `src/conversation.ts` already writes to `.relayos/overseer/conversation_log.jsonl` (project-root-relative). The write path is correct when CWD = project root. The `bin/.relayos/` leak happens when RelayOS is invoked from `bin/` as CWD. The migration must pass explicit `projectRoot` to conversation/provider state writers instead of relying on `process.cwd()`.

**Run Ledger files** at `.relayos/overseer/runs/` are already covered by the existing `.gitignore` entry for `.relayos/overseer/`. No new gitignore entries needed for the runs directory.

---

## 8 · Migration Plan

### 8.1 What changes

| Before | After |
|---|---|
| `bin/.relayos/overseer/` tracked in git | `bin/.relayos/` added to `.gitignore`; existing tracked files removed from git index with `git rm --cached` |
| `appendConversationLog()` uses `process.cwd()` | Uses explicit `projectRoot` param passed through call chain |
| No `active_run.json` or `runs/` directory | New files created on first `run start` |
| `buildOverseerContextPack` has no run layer | Extended to inject Run Ledger summary when active run exists |
| `schema.ts` has `Envelope`, `TaskRecord`, `AuditEvent` | Adds `RunRecord`, `TaskLedgerEntry`, `ContinuationPacket`, `SourceIndexEntry` |

### 8.2 No breaking changes

- All existing MCP tools (`write_overseer_note`, `write_overseer_decision`, `write_handoff_result`, `read_overseer_recent`, `read_overseer_summary`, etc.) are unchanged.
- All existing CLI subcommands are unchanged.
- `OverseerLayout` interface gains no new required fields — `RunLayout` is a separate interface.
- `tasks.jsonl` (existing `TaskRecord` appends) continue unchanged. `TaskLedgerEntry` is a different, run-scoped record.
- `.relayos/overseer/CURRENT_STATE.md`, `NEXT_ACTION.md`, and all other canonical files are read-only from this feature's perspective.

### 8.3 Migration of existing data

No migration of existing `tasks.jsonl`, `timeline.jsonl`, `decisions.jsonl`, or `handoff_results.jsonl`. These continue to accumulate as before. The Run Ledger is additive.

The two tracked files in `bin/.relayos/` are removed from git index (not deleted from disk):

```bash
git rm --cached bin/.relayos/overseer/conversation_log.jsonl
git rm --cached bin/.relayos/overseer/chat_sessions.jsonl
echo "bin/.relayos/" >> .gitignore
```

This is a one-time cleanup commit, done in Task 1.

### 8.4 Rollout order

1. Fix `bin/.relayos/` gitignore leak (standalone commit, safe to ship immediately).
2. Add schema types (additive, no behavior change).
3. Add `src/id.ts` `newRunId()` + `src/overseer.ts` run helpers (no CLI exposure yet).
4. Add CLI `run start|current|compact|complete|abandon|list` with tests.
5. Add four MCP tools with tests.
6. Extend `buildOverseerContextPack` to inject run layer.
7. Fix `appendConversationLog` project-root param.
8. Add ExecutionWorkspace CLI/MCP surfacing (record-only; no cleanup automation).
9. Add repair-policy documentation and schemas as a separate batch: `docs/overseer/REPAIR_ESCALATION_POLICY.md`, `ReviewFinding`, `RepairAttempt`, `RepairPolicyDecision`, `DraftReply`, `EvidenceRef`, and review-loop event records.
10. Add `src/repair_policy.ts` and `src/repair_guidance.ts` only after the base Run Ledger is green. These modules evaluate policy and generate compact guidance; they do not send replies or dispatch repairs without human approval.

Each step is independently green and releasable.

---

## 9 · TDD Task Breakdown

### Shipped status (as of 2026-05-21, branch `feat/run-ledger-continuity`)

| Task | Status | Landing commit(s) |
|---|---|---|
| 1. Fix `bin/.relayos/` git tracking leak | ✅ shipped | `c1e0b39` |
| 2. Add `newRunId()` to `src/id.ts` | ✅ shipped | `b03240d` |
| 3. Run Ledger schemas (incl. `ExecutionWorkspace`) | ✅ shipped | `b03240d` |
| 4. `RunLayout` + run helpers (landed in `src/run_ledger.ts`, see §4 file-layout note) | ✅ shipped | `b03240d` |
| 5. CLI `overseer run` subcommands | ✅ shipped | `120c3b0` |
| 6. MCP tools (`write_run_event` etc.) | ✅ shipped | `120c3b0` |
| 7. Extend `buildOverseerContextPack` with Run Ledger layer | ✅ shipped | `120c3b0` |
| 8. `appendConversationLog` `projectRoot` dependency (+ cooldown follow-up `27d5b1c`) | ✅ shipped | `d7795b5`, `27d5b1c` |
| 9. ExecutionWorkspace CLI + MCP + context-pack surface | ✅ shipped | `c8a0f80` |
| 10. Review / repair schemas + IDs (§2.8–§2.13) | ✅ shipped | `c70a058` |
| 11. Task-scoped storage helpers in `src/run_ledger.ts` | ✅ shipped | `c70a058` |
| 12. Repair policy engine (`src/repair_policy.ts`) — incl. Attempt 3 boundary fix `2871dec` | ✅ shipped | `d7b233b`, `2871dec` |
| 13. Repair guidance generator (`src/repair_guidance.ts`) | ✅ shipped | `d7b233b` |
| 14. Human-contract Markdown (`docs/overseer/REPAIR_ESCALATION_POLICY.md`) | ✅ shipped | `8482654` |
| 15. Repair-layer CLI + MCP tools | ⏸️ **explicitly deferred** | — |

Task 4's helpers landed in a new dedicated module (`src/run_ledger.ts`) rather than being added inline to `src/overseer.ts` as the original task body described. The `src/` listing in §4 of this plan reflects the shipped reality.

The remaining detailed Task entries below preserve the original step-by-step plan for audit purposes; they describe what was implemented, not what is still to do.

---

### Task 1: Fix `bin/.relayos/` git tracking leak

**Files:**
- Modify: `.gitignore`
- Remove from index: `bin/.relayos/overseer/conversation_log.jsonl`, `bin/.relayos/overseer/chat_sessions.jsonl`

- [ ] **Step 1: Verify files are tracked**

```bash
git ls-files bin/.relayos/
```
Expected: lists `bin/.relayos/overseer/conversation_log.jsonl` and `bin/.relayos/overseer/chat_sessions.jsonl`

- [ ] **Step 2: Add `bin/.relayos/` to `.gitignore`**

Open `.gitignore` and append after the existing `.relayos/overseer/` line:
```
bin/.relayos/
```

- [ ] **Step 3: Remove tracked files from git index**

```bash
git rm --cached bin/.relayos/overseer/conversation_log.jsonl
git rm --cached bin/.relayos/overseer/chat_sessions.jsonl
```
Expected: `rm 'bin/.relayos/overseer/conversation_log.jsonl'` (etc.)

- [ ] **Step 4: Verify gitignore takes effect**

```bash
git status bin/.relayos/
```
Expected: not shown as staged or untracked (gitignored)

- [ ] **Step 5: Run typecheck + tests to confirm no regressions**

```bash
npm run typecheck && npm test
```
Expected: all tests green (this change touches no source)

- [ ] **Step 6: Commit**

```bash
git add .gitignore
git commit -m "fix: remove bin/.relayos/ from git tracking, add to .gitignore"
```

---

### Task 2: Add `newRunId()` to `src/id.ts`

**Files:**
- Modify: `src/id.ts`
- Test: `tests/id.test.ts` (existing file — add case)

- [ ] **Step 1: Write failing test**

Add to `tests/id.test.ts`:
```typescript
import { newRunId } from "../src/id.js";

it("newRunId returns r_ prefixed ULID", () => {
  const id = newRunId();
  expect(id).toMatch(/^r_[0-9A-Z]{26}$/);
});

it("newRunId values are unique", () => {
  const a = newRunId();
  const b = newRunId();
  expect(a).not.toBe(b);
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/id.test.ts
```
Expected: FAIL — `newRunId is not a function`

- [ ] **Step 3: Implement**

Add to `src/id.ts` after `newCheckpointId`:
```typescript
export function newRunId(): string {
  return `r_${ulid()}`;
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npm test -- tests/id.test.ts
```
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/id.ts tests/id.test.ts
git commit -m "feat: add newRunId() to id.ts"
```

---

### Task 3: Add Run Ledger types to `src/schema.ts` (incl. ExecutionWorkspace)

**Files:**
- Modify: `src/schema.ts`
- Test: `tests/schema_run.test.ts` (new)

Five new schemas/types: `RunRecord`, `TaskLedgerEntry`, `ContinuationPacket`, `SourceIndexEntry`, and **`ExecutionWorkspace`** (linked execution-location record).

- [ ] **Step 1: Write failing tests**

Create `tests/schema_run.test.ts`:
```typescript
import { RunRecordSchema, TaskLedgerEntrySchema, ContinuationPacketSchema, SourceIndexEntrySchema } from "../src/schema.js";

describe("RunRecord", () => {
  it("validates a minimal active run", () => {
    const r = RunRecordSchema.parse({
      id: "r_01HXYZ",
      status: "active",
      started_at: "2026-05-20T10:00:00Z",
      task_count: 0,
      handoff_ids: [],
    });
    expect(r.status).toBe("active");
  });

  it("rejects unknown status", () => {
    expect(() => RunRecordSchema.parse({ id: "r_x", status: "unknown", started_at: "", task_count: 0, handoff_ids: [] }))
      .toThrow();
  });
});

describe("TaskLedgerEntry", () => {
  it("validates a dispatched entry", () => {
    const e = TaskLedgerEntrySchema.parse({
      seq: 1,
      task_id: "t_01",
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
  });

  it("requires seq >= 1", () => {
    expect(() => TaskLedgerEntrySchema.parse({ seq: 0, task_id: "", run_id: "", user_input: "", status: "pending", created_at: "", updated_at: "" }))
      .toThrow();
  });
});

describe("ContinuationPacket", () => {
  it("validates a packet", () => {
    const p = ContinuationPacketSchema.parse({
      run_id: "r_01",
      generated_at: "2026-05-20T10:05:00Z",
      context_summary: "Adding hello function to util.ts",
      completed_task_ids: ["t_01"],
      pending_task_ids: [],
      open_questions: [],
      next_action: "Run tests",
      files_modified: ["src/util.ts"],
      token_budget_note: "compact after task 1",
    });
    expect(p.context_summary.length).toBeLessThanOrEqual(500);
  });
});

describe("SourceIndexEntry", () => {
  it("validates a created entry", () => {
    const e = SourceIndexEntrySchema.parse({
      path: "src/util.ts",
      action: "modified",
      handoff_id: "h_01",
      task_seq: 1,
      ts: "2026-05-20T10:02:00Z",
    });
    expect(e.action).toBe("modified");
  });
});

describe("ExecutionWorkspace", () => {
  it("validates a git_worktree owned by codex", () => {
    const w = ExecutionWorkspaceSchema.parse({
      id: "w_01HXYZ",
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

  it("rejects unknown kind", () => {
    expect(() => ExecutionWorkspaceSchema.parse({
      id: "w_x", run_id: "r_x", kind: "tarball", path: "/x",
      owner_agent: "human", status: "active",
      created_at: "", updated_at: "", cleanup_policy: "manual",
    })).toThrow();
  });

  it("rejects unknown status", () => {
    expect(() => ExecutionWorkspaceSchema.parse({
      id: "w_x", run_id: "r_x", kind: "main_checkout", path: "/x",
      owner_agent: "human", status: "deleted",
      created_at: "", updated_at: "", cleanup_policy: "manual",
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/schema_run.test.ts
```
Expected: FAIL — imports not found

- [ ] **Step 3: Implement types in `src/schema.ts`**

Add after existing exports:
```typescript
// ── Run Ledger types ──────────────────────────────────────────────────

export const RunRecordSchema = z.object({
  id: z.string().regex(/^r_/),
  status: z.enum(["active", "completed", "abandoned"]),
  started_at: z.string(),
  ended_at: z.string().optional(),
  goal: z.string().optional(),
  branch: z.string().optional(),
  head_sha: z.string().optional(),
  task_count: z.number().int().nonnegative(),
  handoff_ids: z.array(z.string()),
});
export type RunRecord = z.infer<typeof RunRecordSchema>;

export const TaskLedgerEntrySchema = z.object({
  seq: z.number().int().min(1),
  task_id: z.string(),
  run_id: z.string(),
  user_input: z.string(),
  status: z.enum(["pending", "dispatched", "completed", "failed", "blocked"]),
  handoff_id: z.string().optional(),
  target_agent: z.string().optional(),
  model: z.string().optional(),
  effort: z.string().optional(),
  mode: z.string().optional(),
  result_summary: z.string().max(200).optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type TaskLedgerEntry = z.infer<typeof TaskLedgerEntrySchema>;

export const ContinuationPacketSchema = z.object({
  run_id: z.string(),
  generated_at: z.string(),
  context_summary: z.string().max(500),
  completed_task_ids: z.array(z.string()),
  pending_task_ids: z.array(z.string()),
  last_handoff_id: z.string().optional(),
  last_handoff_status: z.string().optional(),
  open_questions: z.array(z.string()),
  next_action: z.string(),
  files_modified: z.array(z.string()),
  token_budget_note: z.string(),
});
export type ContinuationPacket = z.infer<typeof ContinuationPacketSchema>;

export const SourceIndexEntrySchema = z.object({
  path: z.string().min(1),
  action: z.enum(["created", "modified", "deleted"]),
  handoff_id: z.string().optional(),
  task_seq: z.number().int().positive().optional(),
  ts: z.string(),
});
export type SourceIndexEntry = z.infer<typeof SourceIndexEntrySchema>;

export const ExecutionWorkspaceSchema = z.object({
  id: z.string().regex(/^w_/),
  run_id: z.string(),
  task_id: z.string().optional(),
  kind: z.enum(["git_worktree", "main_checkout", "external_checkout"]),
  path: z.string().min(1),
  branch: z.string().optional(),
  base_sha: z.string().optional(),
  head_sha: z.string().optional(),
  owner_agent: z.enum(["claude", "codex", "human", "other"]),
  purpose: z.string().optional(),
  status: z.enum(["active", "merged", "abandoned", "cleaned"]),
  created_at: z.string(),
  updated_at: z.string(),
  cleanup_policy: z.enum(["manual", "auto_on_merge", "auto_on_complete"]),
  related_handoff_id: z.string().optional(),
});
export type ExecutionWorkspace = z.infer<typeof ExecutionWorkspaceSchema>;
```

- [ ] **Step 4: Run to verify pass**

```bash
npm test -- tests/schema_run.test.ts && npm run typecheck
```
Expected: all PASS, typecheck clean

- [ ] **Step 5: Commit**

```bash
git add src/schema.ts tests/schema_run.test.ts
git commit -m "feat: add RunRecord, TaskLedgerEntry, ContinuationPacket, SourceIndexEntry, ExecutionWorkspace schemas"
```

---

### Task 4: Add `RunLayout` and run helpers to `src/overseer.ts`

**Files:**
- Modify: `src/overseer.ts`
- Test: `tests/run_ledger.test.ts` (new)

- [ ] **Step 1: Write failing tests**

Create `tests/run_ledger.test.ts`:
```typescript
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveRunLayout,
  resolveRunsDir,
  readActiveRunId,
  setActiveRunId,
  clearActiveRunId,
  updateRunRecord,
  appendTaskLedgerEntry,
  readTaskLedgerEntries,
  writeContinuationPacket,
  readContinuationPacket,
  appendSourceIndexEntry,
  appendExecutionWorkspace,
  readExecutionWorkspaces,
  updateExecutionWorkspaceStatus,
} from "../src/overseer.js";
import type { RunRecord, TaskLedgerEntry, ContinuationPacket, SourceIndexEntry, ExecutionWorkspace } from "../src/schema.js";

let cwd: string;
beforeEach(() => {
  cwd = join(tmpdir(), `rl_test_${Date.now()}`);
  mkdirSync(join(cwd, ".relayos", "overseer"), { recursive: true });
});
afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

describe("resolveRunsDir", () => {
  it("returns the runs subdir", () => {
    expect(resolveRunsDir(cwd)).toBe(join(cwd, ".relayos", "overseer", "runs"));
  });
});

describe("resolveRunLayout", () => {
  it("returns correct paths for a run id", () => {
    const layout = resolveRunLayout(cwd, "r_01TEST");
    expect(layout.runDir).toContain("r_01TEST");
    expect(layout.taskLedger).toContain("task_ledger.jsonl");
    expect(layout.continuation).toContain("continuation.json");
    expect(layout.sourceIndex).toContain("source_index.jsonl");
  });
});

describe("active run pointer", () => {
  it("returns null when no active run", () => {
    expect(readActiveRunId(cwd)).toBeNull();
  });
  it("round-trips set/read/clear", () => {
    setActiveRunId(cwd, "r_01HXYZ");
    expect(readActiveRunId(cwd)).toBe("r_01HXYZ");
    clearActiveRunId(cwd);
    expect(readActiveRunId(cwd)).toBeNull();
  });
});

describe("updateRunRecord", () => {
  it("creates and reads a RunRecord", () => {
    const run: RunRecord = {
      id: "r_01TEST",
      status: "active",
      started_at: new Date().toISOString(),
      task_count: 0,
      handoff_ids: [],
    };
    updateRunRecord(cwd, run);
    const layout = resolveRunLayout(cwd, "r_01TEST");
    expect(existsSync(layout.runJson)).toBe(true);
  });
});

describe("task ledger", () => {
  it("appends and reads entries", () => {
    const runId = "r_01TEST";
    updateRunRecord(cwd, { id: runId, status: "active", started_at: "", task_count: 0, handoff_ids: [] });
    const entry: TaskLedgerEntry = {
      seq: 1, task_id: "t1", run_id: runId, user_input: "do thing",
      status: "pending", created_at: "", updated_at: "",
    };
    appendTaskLedgerEntry(cwd, runId, entry);
    const entries = readTaskLedgerEntries(cwd, runId, 10);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.seq).toBe(1);
  });

  it("last-write-wins dedup on same seq", () => {
    const runId = "r_01TEST";
    updateRunRecord(cwd, { id: runId, status: "active", started_at: "", task_count: 0, handoff_ids: [] });
    const base = { seq: 1, task_id: "t1", run_id: runId, user_input: "do thing", created_at: "", updated_at: "" };
    appendTaskLedgerEntry(cwd, runId, { ...base, status: "pending" });
    appendTaskLedgerEntry(cwd, runId, { ...base, status: "completed", updated_at: new Date().toISOString() });
    const entries = readTaskLedgerEntries(cwd, runId, 10);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.status).toBe("completed");
  });
});

describe("execution workspaces", () => {
  it("appends and reads workspaces, dedups by id", () => {
    const runId = "r_01TEST";
    updateRunRecord(cwd, { id: runId, status: "active", started_at: "", task_count: 0, handoff_ids: [] });
    const base = {
      id: "w_01", run_id: runId, kind: "git_worktree" as const,
      path: "/tmp/wt", owner_agent: "codex" as const, status: "active" as const,
      created_at: "2026-05-20T10:00:00Z", updated_at: "2026-05-20T10:00:00Z",
      cleanup_policy: "auto_on_merge" as const,
    };
    appendExecutionWorkspace(cwd, runId, base);
    appendExecutionWorkspace(cwd, runId, { ...base, status: "merged", updated_at: "2026-05-20T11:00:00Z" });
    const all = readExecutionWorkspaces(cwd, runId);
    expect(all).toHaveLength(1);
    expect(all[0]!.status).toBe("merged");
  });

  it("supports multiple workspaces per run", () => {
    const runId = "r_01TEST";
    updateRunRecord(cwd, { id: runId, status: "active", started_at: "", task_count: 0, handoff_ids: [] });
    appendExecutionWorkspace(cwd, runId, {
      id: "w_01", run_id: runId, kind: "main_checkout", path: "/a",
      owner_agent: "human", status: "active",
      created_at: "2026-05-20T10:00:00Z", updated_at: "2026-05-20T10:00:00Z",
      cleanup_policy: "manual",
    });
    appendExecutionWorkspace(cwd, runId, {
      id: "w_02", run_id: runId, kind: "git_worktree", path: "/b",
      owner_agent: "codex", status: "active",
      created_at: "2026-05-20T10:00:00Z", updated_at: "2026-05-20T10:00:00Z",
      cleanup_policy: "auto_on_merge",
    });
    expect(readExecutionWorkspaces(cwd, runId)).toHaveLength(2);
  });

  it("updateExecutionWorkspaceStatus appends a status record", () => {
    const runId = "r_01TEST";
    updateRunRecord(cwd, { id: runId, status: "active", started_at: "", task_count: 0, handoff_ids: [] });
    appendExecutionWorkspace(cwd, runId, {
      id: "w_01", run_id: runId, kind: "git_worktree", path: "/x",
      owner_agent: "codex", status: "active",
      created_at: "2026-05-20T10:00:00Z", updated_at: "2026-05-20T10:00:00Z",
      cleanup_policy: "auto_on_merge",
    });
    updateExecutionWorkspaceStatus(cwd, runId, "w_01", "abandoned");
    const all = readExecutionWorkspaces(cwd, runId);
    expect(all[0]!.status).toBe("abandoned");
  });
});

describe("continuation packet", () => {
  it("writes and reads a packet", () => {
    const runId = "r_01TEST";
    updateRunRecord(cwd, { id: runId, status: "active", started_at: "", task_count: 0, handoff_ids: [] });
    const packet: ContinuationPacket = {
      run_id: runId, generated_at: "", context_summary: "test",
      completed_task_ids: [], pending_task_ids: [], open_questions: [],
      next_action: "run tests", files_modified: [], token_budget_note: "",
    };
    writeContinuationPacket(cwd, runId, packet);
    const read = readContinuationPacket(cwd, runId);
    expect(read).not.toBeNull();
    expect(read!.context_summary).toBe("test");
  });

  it("returns null when no packet", () => {
    expect(readContinuationPacket(cwd, "r_NOTEXIST")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/run_ledger.test.ts
```
Expected: FAIL — all imports not found

- [ ] **Step 3: Implement helpers in `src/overseer.ts`**

Add after `resolveOverseerLayout`:

```typescript
// ── Run Ledger layout + helpers ───────────────────────────────────────

export interface RunLayout {
  runDir: string;
  runJson: string;
  taskLedger: string;
  continuation: string;
  sourceIndex: string;
}

export function resolveRunsDir(cwd: string): string {
  return path.join(cwd, ".relayos", "overseer", "runs");
}

export function resolveRunLayout(cwd: string, runId: string): RunLayout {
  const runDir = path.join(resolveRunsDir(cwd), runId);
  return {
    runDir,
    runJson: path.join(runDir, "run.json"),
    taskLedger: path.join(runDir, "task_ledger.jsonl"),
    continuation: path.join(runDir, "continuation.json"),
    sourceIndex: path.join(runDir, "source_index.jsonl"),
    workspaces: path.join(runDir, "WORKSPACES.jsonl"),
  };
}

const ACTIVE_RUN_PATH = (cwd: string) =>
  path.join(cwd, ".relayos", "overseer", "active_run.json");

export function readActiveRunId(cwd: string): string | null {
  try {
    const raw = fs.readFileSync(ACTIVE_RUN_PATH(cwd), "utf8");
    const obj = JSON.parse(raw) as { run_id: string };
    return obj.run_id ?? null;
  } catch { return null; }
}

export function setActiveRunId(cwd: string, runId: string): void {
  fs.writeFileSync(ACTIVE_RUN_PATH(cwd), JSON.stringify({ run_id: runId }), "utf8");
}

export function clearActiveRunId(cwd: string): void {
  try { fs.unlinkSync(ACTIVE_RUN_PATH(cwd)); } catch { /* already gone */ }
}

export function updateRunRecord(cwd: string, run: RunRecord): void {
  const layout = resolveRunLayout(cwd, run.id);
  fs.mkdirSync(layout.runDir, { recursive: true });
  const tmp = layout.runJson + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(run, null, 2), "utf8");
  fs.renameSync(tmp, layout.runJson);
}

export function readRunRecord(cwd: string, runId: string): RunRecord | null {
  const layout = resolveRunLayout(cwd, runId);
  try {
    return JSON.parse(fs.readFileSync(layout.runJson, "utf8")) as RunRecord;
  } catch { return null; }
}

export function appendTaskLedgerEntry(cwd: string, runId: string, entry: TaskLedgerEntry): void {
  const layout = resolveRunLayout(cwd, runId);
  fs.mkdirSync(layout.runDir, { recursive: true });
  fs.appendFileSync(layout.taskLedger, JSON.stringify(entry) + "\n", "utf8");
}

export function readTaskLedgerEntries(cwd: string, runId: string, lastN: number): TaskLedgerEntry[] {
  const layout = resolveRunLayout(cwd, runId);
  try {
    const lines = fs.readFileSync(layout.taskLedger, "utf8").trim().split("\n").filter(Boolean);
    const allEntries = lines.map((l) => JSON.parse(l) as TaskLedgerEntry);
    // Dedup by seq — last-write-wins
    const bySeq = new Map<number, TaskLedgerEntry>();
    for (const e of allEntries) {
      const existing = bySeq.get(e.seq);
      if (!existing || e.updated_at >= existing.updated_at) {
        bySeq.set(e.seq, e);
      }
    }
    const deduped = Array.from(bySeq.values()).sort((a, b) => a.seq - b.seq);
    return deduped.slice(-lastN);
  } catch { return []; }
}

export function writeContinuationPacket(cwd: string, runId: string, packet: ContinuationPacket): void {
  const layout = resolveRunLayout(cwd, runId);
  fs.mkdirSync(layout.runDir, { recursive: true });
  const tmp = layout.continuation + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(packet, null, 2), "utf8");
  fs.renameSync(tmp, layout.continuation);
}

export function readContinuationPacket(cwd: string, runId: string): ContinuationPacket | null {
  const layout = resolveRunLayout(cwd, runId);
  try {
    return JSON.parse(fs.readFileSync(layout.continuation, "utf8")) as ContinuationPacket;
  } catch { return null; }
}

export function appendSourceIndexEntry(cwd: string, runId: string, entry: SourceIndexEntry): void {
  const layout = resolveRunLayout(cwd, runId);
  fs.mkdirSync(layout.runDir, { recursive: true });
  fs.appendFileSync(layout.sourceIndex, JSON.stringify(entry) + "\n", "utf8");
}

export function appendExecutionWorkspace(cwd: string, runId: string, ws: ExecutionWorkspace): void {
  const layout = resolveRunLayout(cwd, runId);
  fs.mkdirSync(layout.runDir, { recursive: true });
  fs.appendFileSync(layout.workspaces, JSON.stringify(ws) + "\n", "utf8");
}

export function readExecutionWorkspaces(cwd: string, runId: string): ExecutionWorkspace[] {
  const layout = resolveRunLayout(cwd, runId);
  try {
    const lines = fs.readFileSync(layout.workspaces, "utf8").trim().split("\n").filter(Boolean);
    const all = lines.map((l) => JSON.parse(l) as ExecutionWorkspace);
    // Dedup by id — last-write-wins on updated_at
    const byId = new Map<string, ExecutionWorkspace>();
    for (const w of all) {
      const existing = byId.get(w.id);
      if (!existing || w.updated_at >= existing.updated_at) byId.set(w.id, w);
    }
    return Array.from(byId.values()).sort((a, b) => a.created_at.localeCompare(b.created_at));
  } catch { return []; }
}

export function updateExecutionWorkspaceStatus(
  cwd: string, runId: string, wsId: string, status: ExecutionWorkspace["status"]
): void {
  const all = readExecutionWorkspaces(cwd, runId);
  const existing = all.find((w) => w.id === wsId);
  if (!existing) throw new Error(`Workspace ${wsId} not found in run ${runId}`);
  appendExecutionWorkspace(cwd, runId, {
    ...existing,
    status,
    updated_at: new Date().toISOString(),
  });
}
```

Note: `RunRecord`, `TaskLedgerEntry`, `ContinuationPacket`, `SourceIndexEntry`, `ExecutionWorkspace` types must be imported from `./schema.js` at the top of the file. The `RunLayout` interface gains the `workspaces` field added in section 2.6.

- [ ] **Step 4: Run to verify pass**

```bash
npm test -- tests/run_ledger.test.ts && npm run typecheck
```
Expected: all PASS, typecheck clean

- [ ] **Step 5: Commit**

```bash
git add src/overseer.ts tests/run_ledger.test.ts
git commit -m "feat: add RunLayout, run helpers to overseer.ts"
```

---

### Task 5: CLI `overseer run` subcommands

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/run_ledger_cli.test.ts` (new)

- [ ] **Step 1: Write failing tests**

Create `tests/run_ledger_cli.test.ts`:
```typescript
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI = join(process.cwd(), "dist", "cli.js");

let cwd: string;
beforeEach(() => {
  cwd = join(tmpdir(), `rl_cli_test_${Date.now()}`);
  mkdirSync(join(cwd, ".relayos", "overseer"), { recursive: true });
});
afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

function runCli(args: string[], workdir = cwd): string {
  return execFileSync("node", [CLI, ...args], { cwd: workdir, encoding: "utf8" });
}

it("run start creates active_run.json and prints run ID", () => {
  const out = runCli(["overseer", "run", "start", "--goal", "test run"]);
  const runId = out.trim();
  expect(runId).toMatch(/^r_/);
  expect(existsSync(join(cwd, ".relayos", "overseer", "active_run.json"))).toBe(true);
});

it("run current returns run info after start", () => {
  runCli(["overseer", "run", "start"]);
  const out = runCli(["overseer", "run", "current"]);
  const obj = JSON.parse(out);
  expect(obj.run.status).toBe("active");
  expect(obj.recent_tasks).toEqual([]);
});

it("run start is idempotent — returns same run ID", () => {
  const id1 = runCli(["overseer", "run", "start"]).trim();
  const id2 = runCli(["overseer", "run", "start"]).trim();
  expect(id1).toBe(id2);
});

it("run complete removes active_run.json", () => {
  runCli(["overseer", "run", "start"]);
  runCli(["overseer", "run", "complete"]);
  expect(existsSync(join(cwd, ".relayos", "overseer", "active_run.json"))).toBe(false);
});

it("run list returns array including completed run", () => {
  runCli(["overseer", "run", "start", "--goal", "listed run"]);
  runCli(["overseer", "run", "complete"]);
  const out = runCli(["overseer", "run", "list"]);
  const arr = JSON.parse(out);
  expect(Array.isArray(arr)).toBe(true);
  expect(arr[0].goal).toBe("listed run");
  expect(arr[0].status).toBe("completed");
});

it("run compact writes continuation.json", () => {
  const id = runCli(["overseer", "run", "start", "--goal", "compact test"]).trim();
  runCli(["overseer", "run", "compact"]);
  expect(existsSync(join(cwd, ".relayos", "overseer", "runs", id, "continuation.json"))).toBe(true);
});
```

Note: these tests require a built `dist/cli.js`. Add a build step before running.

- [ ] **Step 2: Build and run to verify failure**

```bash
npm run build && npm test -- tests/run_ledger_cli.test.ts
```
Expected: FAIL — `Unknown command: run` (or similar)

- [ ] **Step 3: Add `runOverseerRun()` function in `src/cli.ts`**

Add a new function `runOverseerRun(sub: string, args: string[], cwd: string): void` near the `runOverseer()` function. Implement each subcommand using the helpers from `src/overseer.ts`:

```typescript
async function runOverseerRun(sub: string, args: string[], cwd: string): Promise<void> {
  const goalIdx = args.indexOf("--goal");
  const goal = goalIdx >= 0 ? args[goalIdx + 1] : undefined;

  switch (sub) {
    case "start": {
      const existing = readActiveRunId(cwd);
      if (existing) {
        process.stdout.write(existing + "\n");
        return;
      }
      const id = newRunId();
      let branch: string | undefined;
      let head_sha: string | undefined;
      try {
        branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd, encoding: "utf8" }).trim();
        head_sha = execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
      } catch { /* not a git repo */ }
      const run: RunRecord = {
        id, status: "active", started_at: new Date().toISOString(),
        goal, branch, head_sha, task_count: 0, handoff_ids: [],
      };
      updateRunRecord(cwd, run);
      setActiveRunId(cwd, id);
      process.stdout.write(id + "\n");
      return;
    }

    case "current": {
      const runId = readActiveRunId(cwd);
      if (!runId) { process.stderr.write("No active run\n"); process.exit(1); }
      const run = readRunRecord(cwd, runId);
      const recent_tasks = readTaskLedgerEntries(cwd, runId, 10);
      const continuation = readContinuationPacket(cwd, runId);
      process.stdout.write(JSON.stringify({ run, recent_tasks, continuation }, null, 2) + "\n");
      return;
    }

    case "compact": {
      const runId = readActiveRunId(cwd);
      if (!runId) { process.stderr.write("No active run\n"); process.exit(1); }
      const run = readRunRecord(cwd, runId);
      const allEntries = readTaskLedgerEntries(cwd, runId, 1000);
      const completed = allEntries.filter((e) => e.status === "completed").map((e) => e.task_id);
      const pending = allEntries.filter((e) => e.status === "pending" || e.status === "dispatched").map((e) => e.task_id);
      const lastHandoff = allEntries.filter((e) => e.handoff_id).at(-1);
      const packet: ContinuationPacket = {
        run_id: runId,
        generated_at: new Date().toISOString(),
        context_summary: run?.goal ?? "No goal set",
        completed_task_ids: completed,
        pending_task_ids: pending,
        last_handoff_id: lastHandoff?.handoff_id,
        last_handoff_status: lastHandoff?.status,
        open_questions: [],
        next_action: pending.length > 0 ? `Continue task: ${pending[0]}` : "All tasks complete",
        files_modified: [],
        token_budget_note: `${allEntries.length} total tasks; compact generated at ${new Date().toISOString()}`,
      };
      writeContinuationPacket(cwd, runId, packet);
      process.stdout.write(JSON.stringify(packet, null, 2) + "\n");
      return;
    }

    case "complete": {
      const runId = readActiveRunId(cwd);
      if (!runId) { process.stderr.write("No active run\n"); process.exit(1); }
      const run = readRunRecord(cwd, runId);
      if (!run) { process.stderr.write("Run record missing\n"); process.exit(1); }
      updateRunRecord(cwd, { ...run, status: "completed", ended_at: new Date().toISOString() });
      clearActiveRunId(cwd);
      process.stdout.write(`Run ${runId} completed\n`);
      return;
    }

    case "abandon": {
      const runId = readActiveRunId(cwd);
      if (!runId) { process.stderr.write("No active run\n"); process.exit(1); }
      const run = readRunRecord(cwd, runId);
      if (run) updateRunRecord(cwd, { ...run, status: "abandoned", ended_at: new Date().toISOString() });
      clearActiveRunId(cwd);
      process.stdout.write(`Run ${runId ?? "unknown"} abandoned\n`);
      return;
    }

    case "resume": {
      const runId = args.find((a) => a.startsWith("r_"));
      if (!runId) { process.stderr.write("Usage: run resume <run-id>\n"); process.exit(1); }
      const run = readRunRecord(cwd, runId);
      if (!run || run.status === "abandoned") { process.stderr.write("Run not found or abandoned\n"); process.exit(1); }
      setActiveRunId(cwd, runId);
      const continuation = readContinuationPacket(cwd, runId);
      process.stdout.write(JSON.stringify({ resumed: runId, continuation }, null, 2) + "\n");
      return;
    }

    case "list": {
      const runsDir = resolveRunsDir(cwd);
      let entries: RunRecord[] = [];
      try {
        const dirs = fs.readdirSync(runsDir).filter((d) => d.startsWith("r_"));
        for (const d of dirs) {
          const r = readRunRecord(cwd, d);
          if (r) entries.push(r);
        }
      } catch { /* no runs dir */ }
      entries.sort((a, b) => b.started_at.localeCompare(a.started_at));
      process.stdout.write(JSON.stringify(entries, null, 2) + "\n");
      return;
    }

    default:
      process.stderr.write(`Unknown run subcommand: ${sub}\n`);
      process.exit(1);
  }
}
```

In `runOverseer()`, add before the `default:` case:
```typescript
case "run": {
  const sub = args[0] ?? "current";
  await runOverseerRun(sub, args.slice(1), cwd);
  return;
}
```

- [ ] **Step 4: Build and run to verify pass**

```bash
npm run build && npm test -- tests/run_ledger_cli.test.ts && npm run typecheck
```
Expected: all PASS, typecheck clean

- [ ] **Step 5: Run full test suite to check no regressions**

```bash
npm test
```
Expected: all existing tests still passing

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts src/overseer.ts tests/run_ledger_cli.test.ts
git commit -m "feat: add overseer run start|current|compact|complete|abandon|resume|list CLI"
```

---

### Task 6: MCP tools — `write_run_event`, `read_current_run`, `read_current_task_ledger`, `update_task_ledger`

**Files:**
- Create: `src/tools/write_run_event.ts`
- Create: `src/tools/read_current_run.ts`
- Create: `src/tools/read_current_task_ledger.ts`
- Create: `src/tools/update_task_ledger.ts`
- Modify: `src/tools/index.ts`
- Test: `tests/run_ledger_mcp.test.ts` (new)

- [ ] **Step 1: Write failing tests**

Create `tests/run_ledger_mcp.test.ts`:
```typescript
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeRunEventTool } from "../src/tools/write_run_event.js";
import { readCurrentRunTool } from "../src/tools/read_current_run.js";
import { readCurrentTaskLedgerTool } from "../src/tools/read_current_task_ledger.js";
import { updateTaskLedgerTool } from "../src/tools/update_task_ledger.js";
import { setActiveRunId, updateRunRecord } from "../src/overseer.js";
import type { RunRecord } from "../src/schema.js";

let cwd: string;
beforeEach(() => {
  cwd = join(tmpdir(), `rl_mcp_test_${Date.now()}`);
  mkdirSync(join(cwd, ".relayos", "overseer"), { recursive: true });
  const run: RunRecord = {
    id: "r_01TEST", status: "active", started_at: "",
    task_count: 0, handoff_ids: [],
  };
  updateRunRecord(cwd, run);
  setActiveRunId(cwd, "r_01TEST");
});
afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

describe("write_run_event", () => {
  it("appends a task ledger entry and returns ok", async () => {
    const result = await writeRunEventTool({
      seq: 1, user_input: "add util fn", status: "pending",
    }, cwd);
    expect(result.ok).toBe(true);
    expect(result.run_id).toBe("r_01TEST");
    expect(result.seq).toBe(1);
  });

  it("errors when no active run", async () => {
    rmSync(join(cwd, ".relayos", "overseer", "active_run.json"));
    await expect(writeRunEventTool({ seq: 1, user_input: "x", status: "pending" }, cwd))
      .rejects.toThrow(/no active run/i);
  });
});

describe("read_current_run", () => {
  it("returns run + empty tasks", async () => {
    const result = await readCurrentRunTool({}, cwd);
    expect(result.run.id).toBe("r_01TEST");
    expect(result.recent_tasks).toEqual([]);
    expect(result.continuation).toBeNull();
  });
});

describe("read_current_task_ledger", () => {
  it("returns empty array before any events", async () => {
    const result = await readCurrentTaskLedgerTool({ last_n: 10 }, cwd);
    expect(result.entries).toEqual([]);
    expect(result.run_id).toBe("r_01TEST");
  });
});

describe("update_task_ledger", () => {
  it("appends an update record", async () => {
    await writeRunEventTool({ seq: 1, user_input: "x", status: "pending" }, cwd);
    const result = await updateTaskLedgerTool({ seq: 1, status: "completed" }, cwd);
    expect(result.ok).toBe(true);
    const ledger = await readCurrentTaskLedgerTool({ last_n: 10 }, cwd);
    expect(ledger.entries[0]!.status).toBe("completed");
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/run_ledger_mcp.test.ts
```
Expected: FAIL — imports not found

- [ ] **Step 3: Implement `src/tools/write_run_event.ts`**

```typescript
// src/tools/write_run_event.ts
import { z } from "zod";
import { readActiveRunId, appendTaskLedgerEntry, resolveRunLayout } from "../overseer.js";
import type { TaskLedgerEntry } from "../schema.js";

const WriteRunEventInput = z.object({
  seq: z.number().int().min(1),
  user_input: z.string().min(1),
  status: z.enum(["pending", "dispatched", "completed", "failed", "blocked"]),
  handoff_id: z.string().optional(),
  target_agent: z.string().optional(),
  model: z.string().optional(),
  effort: z.string().optional(),
  mode: z.string().optional(),
  result_summary: z.string().max(200).optional(),
});
type WriteRunEventInputType = z.infer<typeof WriteRunEventInput>;

export async function writeRunEventTool(
  rawInput: unknown,
  cwd = process.cwd()
): Promise<{ ok: true; run_id: string; seq: number; path: string }> {
  const input = WriteRunEventInput.parse(rawInput) as WriteRunEventInputType;
  const runId = readActiveRunId(cwd);
  if (!runId) throw new Error("No active run — start one with `overseer run start`");
  const now = new Date().toISOString();
  const entry: TaskLedgerEntry = {
    seq: input.seq,
    task_id: `t_${input.seq}`,
    run_id: runId,
    user_input: input.user_input,
    status: input.status,
    handoff_id: input.handoff_id,
    target_agent: input.target_agent,
    model: input.model,
    effort: input.effort,
    mode: input.mode,
    result_summary: input.result_summary,
    created_at: now,
    updated_at: now,
  };
  appendTaskLedgerEntry(cwd, runId, entry);
  return { ok: true, run_id: runId, seq: input.seq, path: resolveRunLayout(cwd, runId).taskLedger };
}

export const writeRunEventToolDef = {
  name: "write_run_event",
  description: "Append a task ledger entry to the active run. Use to record each task you work on.",
  inputSchema: WriteRunEventInput,
  handler: (input: unknown) => writeRunEventTool(input),
};
```

- [ ] **Step 4: Implement `src/tools/read_current_run.ts`**

```typescript
// src/tools/read_current_run.ts
import { z } from "zod";
import { readActiveRunId, readRunRecord, readTaskLedgerEntries, readContinuationPacket } from "../overseer.js";

const ReadCurrentRunInput = z.object({}).optional();

export async function readCurrentRunTool(
  _input: unknown,
  cwd = process.cwd()
) {
  const runId = readActiveRunId(cwd);
  if (!runId) throw new Error("No active run");
  const run = readRunRecord(cwd, runId);
  if (!run) throw new Error(`Run record missing for ${runId}`);
  const recent_tasks = readTaskLedgerEntries(cwd, runId, 10);
  const continuation = readContinuationPacket(cwd, runId);
  return { run, recent_tasks, continuation };
}

export const readCurrentRunToolDef = {
  name: "read_current_run",
  description: "Read the active run record, 10 most recent task ledger entries, and continuation packet.",
  inputSchema: ReadCurrentRunInput,
  handler: (input: unknown) => readCurrentRunTool(input),
};
```

- [ ] **Step 5: Implement `src/tools/read_current_task_ledger.ts`**

```typescript
// src/tools/read_current_task_ledger.ts
import { z } from "zod";
import { readActiveRunId, readTaskLedgerEntries, resolveRunLayout } from "../overseer.js";
import { existsSync, statSync } from "node:fs";

const ReadCurrentTaskLedgerInput = z.object({
  last_n: z.number().int().min(1).max(100).default(20),
});

export async function readCurrentTaskLedgerTool(
  rawInput: unknown,
  cwd = process.cwd()
) {
  const input = ReadCurrentTaskLedgerInput.parse(rawInput);
  const runId = readActiveRunId(cwd);
  if (!runId) throw new Error("No active run");
  const entries = readTaskLedgerEntries(cwd, runId, input.last_n);
  const ledgerPath = resolveRunLayout(cwd, runId).taskLedger;
  let total_lines = 0;
  try {
    if (existsSync(ledgerPath)) {
      const { size } = statSync(ledgerPath);
      // Approximate — count newlines by size/avg-line-length; accurate count via grep
      total_lines = entries.length; // conservative; exact count not critical
    }
  } catch { /* ignore */ }
  return { run_id: runId, entries, total_lines };
}

export const readCurrentTaskLedgerToolDef = {
  name: "read_current_task_ledger",
  description: "Read the active run's task ledger. Returns deduplicated entries (last-write-wins per seq).",
  inputSchema: ReadCurrentTaskLedgerInput,
  handler: (input: unknown) => readCurrentTaskLedgerTool(input),
};
```

- [ ] **Step 6: Implement `src/tools/update_task_ledger.ts`**

```typescript
// src/tools/update_task_ledger.ts
import { z } from "zod";
import { readActiveRunId, appendTaskLedgerEntry, readTaskLedgerEntries, resolveRunLayout } from "../overseer.js";
import type { TaskLedgerEntry } from "../schema.js";

const UpdateTaskLedgerInput = z.object({
  seq: z.number().int().min(1),
  status: z.enum(["pending", "dispatched", "completed", "failed", "blocked"]).optional(),
  handoff_id: z.string().optional(),
  result_summary: z.string().max(200).optional(),
});

export async function updateTaskLedgerTool(
  rawInput: unknown,
  cwd = process.cwd()
) {
  const input = UpdateTaskLedgerInput.parse(rawInput);
  const runId = readActiveRunId(cwd);
  if (!runId) throw new Error("No active run");
  const existing = readTaskLedgerEntries(cwd, runId, 1000).find((e) => e.seq === input.seq);
  if (!existing) throw new Error(`No task with seq ${input.seq} in ledger`);
  const updated: TaskLedgerEntry = {
    ...existing,
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.handoff_id !== undefined ? { handoff_id: input.handoff_id } : {}),
    ...(input.result_summary !== undefined ? { result_summary: input.result_summary } : {}),
    updated_at: new Date().toISOString(),
  };
  appendTaskLedgerEntry(cwd, runId, updated);
  return { ok: true as const, seq: input.seq, path: resolveRunLayout(cwd, runId).taskLedger };
}

export const updateTaskLedgerToolDef = {
  name: "update_task_ledger",
  description: "Update a task ledger entry by seq number. Appends a new record (last-write-wins on read).",
  inputSchema: UpdateTaskLedgerInput,
  handler: (input: unknown) => updateTaskLedgerTool(input),
};
```

- [ ] **Step 7: Register tools in `src/tools/index.ts`**

Add to the tools export array (following the existing pattern):
```typescript
import { writeRunEventToolDef } from "./write_run_event.js";
import { readCurrentRunToolDef } from "./read_current_run.js";
import { readCurrentTaskLedgerToolDef } from "./read_current_task_ledger.js";
import { updateTaskLedgerToolDef } from "./update_task_ledger.js";

// Add to the tools array:
writeRunEventToolDef,
readCurrentRunToolDef,
readCurrentTaskLedgerToolDef,
updateTaskLedgerToolDef,
```

- [ ] **Step 8: Run to verify pass**

```bash
npm test -- tests/run_ledger_mcp.test.ts && npm run typecheck
```
Expected: all PASS, typecheck clean

- [ ] **Step 9: Run full test suite**

```bash
npm test
```
Expected: all existing tests still passing + new tests passing

- [ ] **Step 10: Commit**

```bash
git add src/tools/write_run_event.ts src/tools/read_current_run.ts \
        src/tools/read_current_task_ledger.ts src/tools/update_task_ledger.ts \
        src/tools/index.ts tests/run_ledger_mcp.test.ts
git commit -m "feat: add write_run_event, read_current_run, read_current_task_ledger, update_task_ledger MCP tools"
```

---

### Task 7: Extend `buildOverseerContextPack` with Run Ledger layer

**Files:**
- Modify: `src/overseer.ts` — `buildOverseerContextPack` function
- Test: existing `tests/overseer.test.ts` — add Run Ledger section cases

- [ ] **Step 1: Write failing tests**

Add to `tests/overseer.test.ts` (or a new section in it):
```typescript
describe("buildOverseerContextPack — Run Ledger layer", () => {
  it("includes run summary when active run exists", async () => {
    const run: RunRecord = {
      id: "r_01TEST", status: "active", started_at: new Date().toISOString(),
      goal: "test goal", task_count: 2, handoff_ids: [],
    };
    updateRunRecord(testCwd, run);
    setActiveRunId(testCwd, "r_01TEST");
    const packet: ContinuationPacket = {
      run_id: "r_01TEST", generated_at: "", context_summary: "test goal",
      completed_task_ids: ["t_1"], pending_task_ids: ["t_2"],
      open_questions: [], next_action: "do next", files_modified: [],
      token_budget_note: "",
    };
    writeContinuationPacket(testCwd, "r_01TEST", packet);

    const pack = await buildOverseerContextPack(testCwd);
    expect(pack).toContain("r_01TEST");
    expect(pack).toContain("test goal");
    expect(pack).toContain("do next");
  });

  it("omits run section when no active run", async () => {
    clearActiveRunId(testCwd);
    const pack = await buildOverseerContextPack(testCwd);
    // Should not throw; run section absent is acceptable
    expect(typeof pack).toBe("string");
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/overseer.test.ts -t "Run Ledger"
```
Expected: FAIL — run ID not found in pack output

- [ ] **Step 3: Extend `buildOverseerContextPack` in `src/overseer.ts`**

In the `buildOverseerContextPack` function, add a Run Ledger section at the end:

```typescript
// After building existing sections, append:
const runId = readActiveRunId(cwd);
if (runId) {
  const run = readRunRecord(cwd, runId);
  const continuation = readContinuationPacket(cwd, runId);
  const recentTasks = readTaskLedgerEntries(cwd, runId, 5);

  let runSection = `\n## Active Run\n`;
  runSection += `Run ID: ${runId}\n`;
  if (run?.goal) runSection += `Goal: ${run.goal}\n`;
  runSection += `Tasks: ${run?.task_count ?? 0} total`;
  if (continuation) {
    runSection += `\nCompleted: ${continuation.completed_task_ids.length}`;
    runSection += `\nPending: ${continuation.pending_task_ids.length}`;
    runSection += `\nNext action: ${continuation.next_action}`;
    if (continuation.context_summary) {
      runSection += `\nContext: ${continuation.context_summary}`;
    }
  }
  if (recentTasks.length > 0) {
    runSection += `\n\nRecent tasks:\n`;
    for (const t of recentTasks) {
      runSection += `  ${t.seq}. [${t.status}] ${t.user_input.slice(0, 80)}\n`;
    }
  }
  contextPack += runSection;
}
```

(Exact implementation depends on the current structure of `buildOverseerContextPack` — adapt the insertion point to match the existing concatenation style.)

- [ ] **Step 4: Run to verify pass**

```bash
npm test -- tests/overseer.test.ts && npm run typecheck
```
Expected: all PASS

- [ ] **Step 5: Run full test suite**

```bash
npm test
```
Expected: all tests passing

- [ ] **Step 6: Commit**

```bash
git add src/overseer.ts tests/overseer.test.ts
git commit -m "feat: inject active Run Ledger summary into overseer context pack"
```

---

### Task 8: Fix `appendConversationLog` project-root dependency

**Files:**
- Modify: `src/conversation.ts`
- Modify: any callers that need to pass `projectRoot`

- [ ] **Step 1: Find all call sites**

```bash
grep -rn "appendConversationLog" src/
```
Note all call sites and their available CWD context.

- [ ] **Step 2: Write test verifying correct write path**

Add to appropriate test file:
```typescript
it("appendConversationLog writes to explicit projectRoot, not process.cwd()", () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), "conv_test_"));
  mkdirSync(join(tmpRoot, ".relayos", "overseer"), { recursive: true });
  appendConversationLog("user", "hello", tmpRoot);
  const logPath = join(tmpRoot, ".relayos", "overseer", "conversation_log.jsonl");
  expect(existsSync(logPath)).toBe(true);
  rmSync(tmpRoot, { recursive: true, force: true });
});
```

- [ ] **Step 3: Add `projectRoot` parameter**

In `src/conversation.ts` around line 647, change:
```typescript
// Before:
export function appendConversationLog(role: string, content: string): void {
  const logPath = path.join(process.cwd(), ".relayos", "overseer", "conversation_log.jsonl");
  // ...
}

// After:
export function appendConversationLog(role: string, content: string, projectRoot?: string): void {
  const root = projectRoot ?? process.cwd();
  const logPath = path.join(root, ".relayos", "overseer", "conversation_log.jsonl");
  // ...
}
```

Pass `projectRoot` from callers where available (typically from config or `resolveOverseerLayout` CWD).

- [ ] **Step 4: Run typecheck and full tests**

```bash
npm run typecheck && npm test
```
Expected: all passing

- [ ] **Step 5: Commit**

```bash
git add src/conversation.ts
git commit -m "fix: pass explicit projectRoot to appendConversationLog, remove process.cwd() dependency"
```

---

### Task 9: ExecutionWorkspace CLI subcommands + MCP tool

**Files:**
- Modify: `src/cli.ts` — add `workspace` subcommands under `overseer run`
- Create: `src/tools/register_execution_workspace.ts`
- Create: `src/tools/read_execution_workspaces.ts`
- Modify: `src/tools/index.ts`
- Test: `tests/run_ledger_cli.test.ts` — add workspace subcommand cases
- Test: `tests/run_ledger_mcp.test.ts` — add workspace tool cases

**CLI surface (added under existing `overseer run` dispatch):**

| Subcommand | Behavior |
|---|---|
| `overseer run register-workspace --kind <kind> --path <path> --owner <agent> [--branch ...] [--base-sha ...] [--purpose ...] [--cleanup auto_on_merge\|manual\|auto_on_complete] [--handoff h_...]` | Append a new `ExecutionWorkspace` record with `id = w_<ULID>`. Prints workspace ID. Errors if no active run. |
| `overseer run list-workspaces [<run-id>]` | List workspaces for the given run (or active run). JSON array, deduped, last-write-wins. |
| `overseer run update-workspace <w-id> --status <active\|merged\|abandoned\|cleaned> [--head-sha ...]` | Append a status transition for the workspace. |

**MCP tools (two new, additive):**

#### `register_execution_workspace`

```typescript
// src/tools/register_execution_workspace.ts
const RegisterExecutionWorkspaceInput = z.object({
  kind: z.enum(["git_worktree", "main_checkout", "external_checkout"]),
  path: z.string().min(1),
  owner_agent: z.enum(["claude", "codex", "human", "other"]),
  branch: z.string().optional(),
  base_sha: z.string().optional(),
  head_sha: z.string().optional(),
  task_id: z.string().optional(),
  purpose: z.string().optional(),
  cleanup_policy: z.enum(["manual", "auto_on_merge", "auto_on_complete"]).default("manual"),
  related_handoff_id: z.string().optional(),
});
// Returns: { ok: true, workspace_id: "w_...", run_id, path }
```

Errors if no active run. Records `id = w_<new ULID>`, `status = "active"`, both timestamps = now.

#### `read_execution_workspaces`

```typescript
// src/tools/read_execution_workspaces.ts
const ReadExecutionWorkspacesInput = z.object({
  run_id: z.string().optional(),  // defaults to active run
  status: z.enum(["active", "merged", "abandoned", "cleaned"]).optional(),
});
// Returns: { run_id, workspaces: ExecutionWorkspace[] }
```

Reads from `WORKSPACES.jsonl`, dedups by `id`, optionally filters by `status`.

- [ ] **Step 1: Write failing CLI tests**

Add to `tests/run_ledger_cli.test.ts`:
```typescript
it("run register-workspace creates a workspace record", () => {
  runCli(["overseer", "run", "start"]);
  const wsId = runCli([
    "overseer", "run", "register-workspace",
    "--kind", "git_worktree",
    "--path", "/tmp/test-wt",
    "--owner", "codex",
    "--branch", "feat/x",
    "--purpose", "task 1",
  ]).trim();
  expect(wsId).toMatch(/^w_/);
});

it("run list-workspaces returns registered workspaces", () => {
  runCli(["overseer", "run", "start"]);
  runCli(["overseer", "run", "register-workspace",
          "--kind", "git_worktree", "--path", "/tmp/a", "--owner", "codex"]);
  runCli(["overseer", "run", "register-workspace",
          "--kind", "main_checkout", "--path", "/tmp/b", "--owner", "human"]);
  const arr = JSON.parse(runCli(["overseer", "run", "list-workspaces"]));
  expect(arr).toHaveLength(2);
});

it("run update-workspace appends a status record", () => {
  runCli(["overseer", "run", "start"]);
  const wsId = runCli(["overseer", "run", "register-workspace",
                       "--kind", "git_worktree", "--path", "/tmp/c",
                       "--owner", "codex"]).trim();
  runCli(["overseer", "run", "update-workspace", wsId, "--status", "merged"]);
  const arr = JSON.parse(runCli(["overseer", "run", "list-workspaces"]));
  expect(arr[0].status).toBe("merged");
});
```

- [ ] **Step 2: Write failing MCP tests**

Add to `tests/run_ledger_mcp.test.ts`:
```typescript
describe("register_execution_workspace", () => {
  it("registers and returns workspace_id", async () => {
    const result = await registerExecutionWorkspaceTool({
      kind: "git_worktree",
      path: "/tmp/x",
      owner_agent: "codex",
    }, cwd);
    expect(result.ok).toBe(true);
    expect(result.workspace_id).toMatch(/^w_/);
  });
});

describe("read_execution_workspaces", () => {
  it("returns workspaces deduped and filtered by status", async () => {
    await registerExecutionWorkspaceTool({
      kind: "git_worktree", path: "/tmp/a", owner_agent: "codex",
    }, cwd);
    await registerExecutionWorkspaceTool({
      kind: "main_checkout", path: "/tmp/b", owner_agent: "human",
    }, cwd);
    const all = await readExecutionWorkspacesTool({}, cwd);
    expect(all.workspaces).toHaveLength(2);
    const onlyActive = await readExecutionWorkspacesTool({ status: "active" }, cwd);
    expect(onlyActive.workspaces).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Implement CLI subcommands**

Extend the `switch (sub)` in `runOverseerRun()` (Task 5) with three additional cases:

```typescript
case "register-workspace": {
  const runId = readActiveRunId(cwd);
  if (!runId) { process.stderr.write("No active run\n"); process.exit(1); }
  const arg = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const kind = arg("--kind") as ExecutionWorkspace["kind"] | undefined;
  const wsPath = arg("--path");
  const owner = arg("--owner") as ExecutionWorkspace["owner_agent"] | undefined;
  if (!kind || !wsPath || !owner) {
    process.stderr.write("Usage: run register-workspace --kind <k> --path <p> --owner <a> ...\n");
    process.exit(1);
  }
  const id = `w_${ulid()}`;
  const now = new Date().toISOString();
  const ws: ExecutionWorkspace = {
    id, run_id: runId, kind, path: wsPath, owner_agent: owner,
    branch: arg("--branch"),
    base_sha: arg("--base-sha"),
    head_sha: arg("--head-sha"),
    task_id: arg("--task-id"),
    purpose: arg("--purpose"),
    status: "active",
    created_at: now, updated_at: now,
    cleanup_policy: (arg("--cleanup") as ExecutionWorkspace["cleanup_policy"]) ?? "manual",
    related_handoff_id: arg("--handoff"),
  };
  appendExecutionWorkspace(cwd, runId, ws);
  process.stdout.write(id + "\n");
  return;
}

case "list-workspaces": {
  const targetRunId = args.find((a) => a.startsWith("r_")) ?? readActiveRunId(cwd);
  if (!targetRunId) { process.stderr.write("No active run\n"); process.exit(1); }
  const all = readExecutionWorkspaces(cwd, targetRunId);
  process.stdout.write(JSON.stringify(all, null, 2) + "\n");
  return;
}

case "update-workspace": {
  const runId = readActiveRunId(cwd);
  if (!runId) { process.stderr.write("No active run\n"); process.exit(1); }
  const wsId = args.find((a) => a.startsWith("w_"));
  if (!wsId) { process.stderr.write("Usage: run update-workspace <w-id> --status <s>\n"); process.exit(1); }
  const statusIdx = args.indexOf("--status");
  const status = statusIdx >= 0 ? args[statusIdx + 1] as ExecutionWorkspace["status"] : undefined;
  if (!status) { process.stderr.write("--status required\n"); process.exit(1); }
  updateExecutionWorkspaceStatus(cwd, runId, wsId, status);
  process.stdout.write(`Workspace ${wsId} → ${status}\n`);
  return;
}
```

- [ ] **Step 4: Implement `src/tools/register_execution_workspace.ts`**

```typescript
import { z } from "zod";
import { ulid } from "ulidx";
import { readActiveRunId, appendExecutionWorkspace } from "../overseer.js";
import type { ExecutionWorkspace } from "../schema.js";

const RegisterExecutionWorkspaceInput = z.object({
  kind: z.enum(["git_worktree", "main_checkout", "external_checkout"]),
  path: z.string().min(1),
  owner_agent: z.enum(["claude", "codex", "human", "other"]),
  branch: z.string().optional(),
  base_sha: z.string().optional(),
  head_sha: z.string().optional(),
  task_id: z.string().optional(),
  purpose: z.string().optional(),
  cleanup_policy: z.enum(["manual", "auto_on_merge", "auto_on_complete"]).default("manual"),
  related_handoff_id: z.string().optional(),
});

export async function registerExecutionWorkspaceTool(
  rawInput: unknown,
  cwd = process.cwd()
): Promise<{ ok: true; workspace_id: string; run_id: string; path: string }> {
  const input = RegisterExecutionWorkspaceInput.parse(rawInput);
  const runId = readActiveRunId(cwd);
  if (!runId) throw new Error("No active run — start one with `overseer run start`");
  const id = `w_${ulid()}`;
  const now = new Date().toISOString();
  const ws: ExecutionWorkspace = {
    id, run_id: runId,
    kind: input.kind, path: input.path, owner_agent: input.owner_agent,
    branch: input.branch, base_sha: input.base_sha, head_sha: input.head_sha,
    task_id: input.task_id, purpose: input.purpose,
    status: "active", created_at: now, updated_at: now,
    cleanup_policy: input.cleanup_policy,
    related_handoff_id: input.related_handoff_id,
  };
  appendExecutionWorkspace(cwd, runId, ws);
  return { ok: true, workspace_id: id, run_id: runId, path: input.path };
}

export const registerExecutionWorkspaceToolDef = {
  name: "register_execution_workspace",
  description: "Record where work happened (git worktree, main checkout, or external checkout) and who owns it. Use when spawning a new working tree or before a handoff applies patches.",
  inputSchema: RegisterExecutionWorkspaceInput,
  handler: (input: unknown) => registerExecutionWorkspaceTool(input),
};
```

- [ ] **Step 5: Implement `src/tools/read_execution_workspaces.ts`**

```typescript
import { z } from "zod";
import { readActiveRunId, readExecutionWorkspaces } from "../overseer.js";

const ReadExecutionWorkspacesInput = z.object({
  run_id: z.string().optional(),
  status: z.enum(["active", "merged", "abandoned", "cleaned"]).optional(),
});

export async function readExecutionWorkspacesTool(
  rawInput: unknown,
  cwd = process.cwd()
) {
  const input = ReadExecutionWorkspacesInput.parse(rawInput);
  const runId = input.run_id ?? readActiveRunId(cwd);
  if (!runId) throw new Error("No active run");
  const all = readExecutionWorkspaces(cwd, runId);
  const filtered = input.status ? all.filter((w) => w.status === input.status) : all;
  return { run_id: runId, workspaces: filtered };
}

export const readExecutionWorkspacesToolDef = {
  name: "read_execution_workspaces",
  description: "List execution workspaces for a run (defaults to active run). Optionally filter by status.",
  inputSchema: ReadExecutionWorkspacesInput,
  handler: (input: unknown) => readExecutionWorkspacesTool(input),
};
```

- [ ] **Step 6: Register the two tools in `src/tools/index.ts`**

```typescript
import { registerExecutionWorkspaceToolDef } from "./register_execution_workspace.js";
import { readExecutionWorkspacesToolDef } from "./read_execution_workspaces.js";
// Add to the tools array:
registerExecutionWorkspaceToolDef,
readExecutionWorkspacesToolDef,
```

- [ ] **Step 7: Build, run all tests, typecheck**

```bash
npm run build && npm test && npm run typecheck
```
Expected: all PASS, all CLI and MCP workspace tests green, no regressions.

- [ ] **Step 8: Extend `buildOverseerContextPack` to include active workspaces**

After the existing Run Ledger section, append (when active run exists):

```typescript
const workspaces = readExecutionWorkspaces(cwd, runId).filter((w) => w.status === "active");
if (workspaces.length > 0) {
  runSection += `\nActive workspaces:\n`;
  for (const w of workspaces) {
    runSection += `  ${w.id} [${w.kind}] ${w.path} (${w.owner_agent})\n`;
  }
}
```

This surfaces the workspaces section in the cold-start context so a resuming agent knows what physical state exists. Add a test in `tests/overseer.test.ts` mirroring the Task 7 pattern.

- [ ] **Step 9: Commit**

```bash
git add src/cli.ts src/tools/register_execution_workspace.ts \
        src/tools/read_execution_workspaces.ts src/tools/index.ts \
        src/overseer.ts tests/run_ledger_cli.test.ts \
        tests/run_ledger_mcp.test.ts tests/overseer.test.ts
git commit -m "feat: add ExecutionWorkspace CLI (register/list/update) + MCP tools, surface in context pack"
```

---

### Task 10: Review / repair schemas + IDs

**Files:**
- Modify: `src/schema.ts`
- Modify: `src/id.ts`
- Modify: `tests/run_ledger_schema.test.ts` (extend; do not create a parallel file)

This task turns §2.8–§2.13 into Zod schemas + inferred types. It changes no runtime behavior. Implementation only — no CLI, no MCP, no storage helpers yet.

- [ ] **Step 1:** Add `ReviewFinding`, `RepairAttempt` (with `RepairMode`, `RepairResult`, `RepairVariableChange` unions), `RepairPolicyDecision` (with `RepairDecisionKind`, `RepairReasonCode` unions), `DraftReply`, and the `EvidenceRef` discriminated union to `src/schema.ts`. Each `id` field has the corresponding regex (`f_` / `a_` / `d_` / `dr_`). Also add the §2.13 event records: `BatchReport` (`br_`), `ReviewPass` (`rp_`), `UserApproval` (`ua_`), `ReplySent` (`rs_`), `Result` (`res_`). **`RepairAttempt` MUST also carry `required_tests: string[]` and `reviewer: "human" | "claude" | "codex" | "static_analysis" | "test_runner"`** so the §3.2 variable-change rule has all seven axes (`effort | model | provider | mode | scope | tests | reviewer`) as first-class fields — see Task 12 Step 1 for why the policy engine cannot enforce the rule otherwise.
- [ ] **Step 2:** Add `newReviewFindingId`, `newRepairAttemptId`, `newRepairDecisionId`, `newDraftReplyId`, `newBatchReportId`, `newReviewPassId`, `newUserApprovalId`, `newReplySentId`, `newResultId` plus their `is*Id` validators to `src/id.ts`. Match the existing `newRunId` / `newExecutionWorkspaceId` shape.
- [ ] **Step 3:** Extend `tests/run_ledger_schema.test.ts` with cases for: every required field, every enum rejecting an unknown value, the `prompt_summary` ≤ 240-char cap, the `summary` ≤ 600-char cap, the `result_summary` ≤ 200-char cap, the `EvidenceRef` discriminated-union narrowing, the `guidance_budget_words` cap of 1,200, and the invariant that `RepairAttempt.attempt_number > 1` may be parsed with empty `changed_variables_since_previous_attempt` at the schema level (the variable-change check belongs to the policy engine, not the schema — call this out in a comment).
- [ ] **Step 4:** `npm run typecheck && npm test`. All new + existing tests green.
- [ ] **Step 5:** Commit: `feat(repair): add ReviewFinding / RepairAttempt / RepairPolicyDecision / DraftReply schemas`.

Expected result: every shape from §2.8–§2.12 round-trips through Zod and refuses bad input. No storage written yet.

---

### Task 11: Task-scoped storage helpers in `src/run_ledger.ts`

**Files:**
- Modify: `src/run_ledger.ts`
- Modify: `tests/run_ledger.test.ts` (extend)

Extend Batch 1's `run_ledger.ts` with the task-scoped helpers listed in §4. Empty-state behavior is part of the contract: every read returns `[]` or `null` when the file is missing.

- [ ] **Step 1:** Add `TaskLayout` and `resolveTaskLayout(cwd, runId, taskId)`. Path is `<runDir>/tasks/<task_id>/`. Provide `taskDir`, `taskLedgerMd`, `reviewFindings`, `repairAttempts`, `repairDecisions`, `draftReplies`, `repairGuidance`.
- [ ] **Step 2:** Add `appendReviewFinding` / `readReviewFindings` (dedup by `id`, last-write-wins on `updated_at`).
- [ ] **Step 3:** Add `appendRepairAttempt` / `readRepairAttempts` (dedup by `id`, sort by `attempt_number` ascending). Add `readLatestRepairAttempt(cwd, runId, taskId, findingId)`.
- [ ] **Step 4:** Add `appendRepairDecision` / `readActiveRepairDecision` (latest per `finding_id` is active).
- [ ] **Step 5:** Add `appendDraftReply` / `readDraftReplies` (dedup by `id`, last-write-wins on `approved_at ?? created_at`).
- [ ] **Step 6:** Add `writeRepairGuidance(cwd, runId, taskId, markdown)` and `readRepairGuidance(cwd, runId, taskId)`. Write is atomic via `.tmp` + rename. Read returns `null` when missing.
- [ ] **Step 7:** Extend `tests/run_ledger.test.ts` with: empty-state for every new reader; round-trip for every appender; dedup proofs for findings/attempts/decisions/replies; ordering proof for attempts (by `attempt_number`); active-decision-per-finding proof.
- [ ] **Step 8:** `npm run typecheck && npm test`.
- [ ] **Step 9:** Commit: `feat(repair): add task-scoped storage helpers (no CLI/MCP)`.

Expected result: every task-scoped file from §4 has a tested read/write helper. The policy engine and guidance generator (Tasks 12-13) have all the persistence they need. **No CLI, no MCP, no policy enforcement yet** — the engine is the next task.

---

### Task 12: Repair policy engine (`src/repair_policy.ts`)

**Files:**
- Create: `src/repair_policy.ts`
- Create: `tests/repair_policy.test.ts`

Pure function. No IO. No Python. The engine reads structured ledger objects and returns a `RepairPolicyDecision`. CLI/MCP tools that will eventually call it are out of scope for this task.

- [ ] **Step 1:** Define `EvaluateRepairPolicyInput` per §3. `proposed_next` MUST carry all seven `RepairVariableChange` axes from §3.2 (`effort | model | provider | mode | scope | tests | reviewer`); the engine can only enforce the variable-change rule if its input shape exposes every variable it must compare. `scope` is represented by `required_scope`; `tests` and `reviewer` are first-class fields:
  ```typescript
  interface EvaluateRepairPolicyInput {
    finding: ReviewFinding;
    attempts: RepairAttempt[];               // ALL prior attempts for this finding, chronological
    proposed_next: {                         // what the caller wants to do next — all 7 variables present
      provider: "claude" | "codex" | "other";
      model: string;
      effort: "low" | "medium" | "high" | "xhigh" | "max";
      mode: RepairMode;
      required_scope: { allowed_files: string[]; forbidden_files: string[] };
      required_tests: string[];              // e.g. ["tests/run_ledger.test.ts", "tests/repair_policy.test.ts::happy_path"]
      reviewer: "human" | "claude" | "codex" | "static_analysis" | "test_runner";
    };
    triggers: RepairReasonCode[];            // reviewer-supplied trigger codes
    ladder: ModelLadderConfig;               // small config table; defaults below
  }

  interface ModelLadderConfig {
    effort_order: ("low" | "medium" | "high" | "xhigh" | "max")[];   // default ["low","medium","high","xhigh","max"]
    model_tiers_by_provider: Record<"claude" | "codex" | "other", string[]>;
  }
  ```
  `RepairAttempt` already carries the corresponding fields from §2.9: `provider`, `model`, `effort`, `mode`, and `required_scope`. Task 10 extends `RepairAttempt` with `required_tests: string[]` and `reviewer: ...` so the engine can compare like-for-like across the full set without inferring values from prose. (This is a schema additive in Task 10 — call it out in that task's Step 1.)
- [ ] **Step 2:** Implement `evaluateRepairPolicy(input): RepairPolicyDecision`:
  1. If `attempts.length === 0` → return `allow_retry` for `proposed_next` (this is Attempt 1).
  2. Compare `proposed_next` against the most recent attempt across **all seven `RepairVariableChange` axes**: `provider`, `model`, `effort`, `mode`, `required_scope` (deep equality on the sorted file lists), `required_tests` (deep equality on the sorted list), and `reviewer`. Any axis differing constitutes a valid variable change. If all seven are identical → emit `decision: "stop_needs_human"`, reason `same_model_effort_mode_requested`, OR emit `decision: "escalate_effort"`/`"escalate_model"` if a ladder step exists. The set of "changed axes" is what populates `RepairAttempt.changed_variables_since_previous_attempt` on the resulting attempt record.
  3. Apply the §3.4 triggers: any of `test_modified_to_pass`, `forbidden_file_touched`, `scope_expanded`, `evidence_contradiction`, `report_contradicts_repo_evidence`, `agent_cannot_explain_root_cause`, `tests_pass_but_grep_unresolved` force a mode change or a stop per the table.
  4. Apply the §3.5 stop conditions (attempts ≥ 3 without new variable; no ladder step left; reason-code repetition across two attempts).
  5. Always emit `requires_human_approval = true` in this batch (§3.6). A future revision may change this; this revision does not.
  6. Set `guidance_budget_words` (default 750, hard cap 1200).
- [ ] **Step 3:** Tests in `tests/repair_policy.test.ts`:
  - Attempt 1 returns `allow_retry`.
  - Attempt 2 with identical proposed_next across **all seven axes** returns `stop_needs_human` (reason `same_model_effort_mode_requested`) when no ladder step exists, OR an escalation decision when one does.
  - Attempt 2 after `incomplete` Attempt 1 with effort `medium` proposes `high` and returns `escalate_effort`.
  - Attempt 3 after two `failed` attempts at the same provider returns `escalate_model` or `switch_provider`.
  - After Attempt 3, return `stop_needs_human` with `max_attempts_reached`.
  - Forbidden-file trigger returns `stop_needs_human` if `proposed_next` still touches a forbidden file.
  - **`required_tests` change counts as a valid variable change.** Construct an attempt that fails with `required_tests = ["tests/a.test.ts"]`, then propose a next attempt with `required_tests = ["tests/a.test.ts", "tests/b.test.ts"]` and otherwise identical fields. The engine must NOT return `stop_needs_human` with `same_model_effort_mode_requested`; it must return a non-stop decision and the resulting decision's `RepairAttempt.changed_variables_since_previous_attempt` must include `"tests"`.
  - **`reviewer` change counts as a valid variable change.** Construct an attempt that fails with `reviewer = "claude"`, then propose a next attempt with `reviewer = "static_analysis"` and otherwise identical fields. The engine must NOT return `same_model_effort_mode_requested`; the changed-variables set must include `"reviewer"`.
  - **Variable-change invariant (covers Verification item 15):** for every test where the latest prior `RepairAttempt.result` is `"incomplete"` or `"failed"`, assert that `evaluateRepairPolicy()` returns either `decision === "stop_needs_human"` OR a proposed next attempt that differs from the latest attempt in at least one `RepairVariableChange` axis. A property-style test sweeps a small matrix of (effort, model, provider, mode, scope, tests, reviewer) single-variable changes and asserts the engine accepts each as a valid variable change.
  - Every decision in every test has `requires_human_approval === true`.
  - Every decision carries ≥ 1 reason code.
- [ ] **Step 4:** `npm run typecheck && npm test`.
- [ ] **Step 5:** Commit: `feat(repair): add evaluateRepairPolicy() (machine-checkable, no IO)`.

Expected result: the policy engine returns a decision for any input, and the test suite locks in every §3.2–§3.5 rule. No file IO. No agent dispatch.

---

### Task 13: Repair guidance generator (`src/repair_guidance.ts`)

**Files:**
- Create: `src/repair_guidance.ts`
- Create: `tests/repair_guidance.test.ts`

Pure function. Renders `REPAIR_GUIDANCE.md` from structured input. No transcript dumps. Word-budgeted.

- [ ] **Step 1:** Define `GuidanceInputs` (§3.7) and `GeneratedGuidance` (`{ markdown, word_count, truncated }`).
- [ ] **Step 2:** Implement `generateRepairGuidance(inputs, budgetWords): GeneratedGuidance`:
  1. Render sections 1–9 in the §3.8 order with the §3.8 per-section caps.
  2. If total exceeds `budgetWords`, apply the §3.8 truncation priority (older "Previous attempts" entries summarised, then "What failed" reason codes truncated).
  3. If still over after truncation, emit a stub guidance (≤ 200 words) with a pointer to the ledger, set `truncated = true`.
  4. Enforce hard cap 1,200 words regardless of `budgetWords`.
  5. Refuse to inline raw prompts/replies. Use `prompt_summary` only.
- [ ] **Step 3:** Tests in `tests/repair_guidance.test.ts`:
  - Default 750-word budget produces ≤ 750-word output for a typical input.
  - 100-attempt input renders ≤ 1,200 words and sets `truncated = true`.
  - Asking for `budgetWords: 2000` is silently clamped to 1,200 (or rejected — pick one and lock it).
  - Guidance contains all 9 required sections in order.
  - Guidance never contains the strings `\nuser:`, `\nassistant:`, `<message>` (regex assertion).
  - Forbidden-files section is present whenever `decision.next_required_scope.forbidden_files` is non-empty.
- [ ] **Step 4:** `npm run typecheck && npm test`.
- [ ] **Step 5:** Commit: `feat(repair): add generateRepairGuidance() (budget-capped, no transcript)`.

Expected result: a compact `REPAIR_GUIDANCE.md` can be produced from any policy decision + ledger state. Cost of an Attempt 2/3 model call is bounded by `budgetWords`, not by conversation length.

---

### Task 14: Human-contract Markdown — `docs/overseer/REPAIR_ESCALATION_POLICY.md`

**Files:**
- Create: `docs/overseer/REPAIR_ESCALATION_POLICY.md`

Pure documentation. No code change.

- [ ] **Step 1:** Author the doc as the human-readable companion to §3. Required sections (one Markdown heading each):
  1. **Why this policy exists** — point at the same-model retry failure mode.
  2. **Variable-change rule** — verbatim from §3.2.
  3. **Model / effort escalation ladder** — verbatim table from §3.3.
  4. **Escalation triggers** — verbatim table from §3.4.
  5. **Stop conditions** — verbatim from §3.5.
  6. **Human approval is the default** — verbatim from §3.6, plus an explicit statement that no future `auto_reply_policy` may be enabled without a plan revision.
  7. **Token-saving requirements** — pointers to §3.7/§3.8.
  8. **What enforces this** — link to `src/repair_policy.ts` and its tests. Note that the engine, not the Markdown, is the runtime contract.
  9. **No Python** — one sentence stating that policy logic is TypeScript-only.
- [ ] **Step 2:** Add a CHANGELOG line at the bottom referencing the plan file and the task that introduced it.
- [ ] **Step 3:** Commit: `docs(overseer): add REPAIR_ESCALATION_POLICY.md (human contract)`.

Expected result: contributors have a single Markdown file to read for the policy intent; that file points at the TypeScript engine for enforcement details.

---

### Task 15: Repair-layer CLI subcommands + MCP tools (DEFERRED — separate batch)

**Files:**
- (deferred — listed for plan completeness only)

Once Tasks 10–14 have landed and been reviewed, a future batch may add CLI subcommands (`overseer review add-finding`, `overseer repair record-attempt`, `overseer repair decide`, `overseer repair draft`) and matching MCP tools. These are **explicitly not part of this plan** — they are listed here so the plan's task graph is complete.

The reason for the defer: the storage helpers (Task 11), the policy engine (Task 12), and the guidance generator (Task 13) are the load-bearing pieces. Exposing them through CLI/MCP before they have been reviewed is exactly the failure mode this plan is built to avoid (cf. §3.1 — Markdown alone is not enforcement). The deferral makes the surface explicit so the user knows what is not landing in this plan.

---

## 10 · Open Questions

These are the only genuine blockers. All have reasonable defaults called out.

**Q1: Where should `run start` be called automatically?**
The plan assumes agents call `overseer run start` explicitly at the start of each session, and the `read_current_run` MCP tool is called at agent startup. An alternative is auto-starting a run when the first handoff is created if no active run exists. **Default chosen:** explicit `run start`; no auto-start. Agents must call it. This keeps the behavior predictable and auditable.

**Q2: Should `task_ledger.jsonl` entries use `task_id` from `tasks.jsonl` (existing `TaskRecord`) or be independent?**
The `TaskRecord` in `tasks.jsonl` (written by the full pipeline in `src/overseer.ts:appendTaskRecord`) and `TaskLedgerEntry` in the run ledger could share IDs. **Default chosen:** independent — `TaskLedgerEntry.task_id` is `t_<seq>` (auto-generated). Cross-linking via `handoff_id` is sufficient. Avoiding the dependency keeps the run ledger writable without the full pipeline.

**Q3: What is the correct token cap for `context_summary` in `ContinuationPacket`?**
500 characters is the plan's default. At ~4 chars/token this is ~125 tokens — generous for a one-liner, tight for a multi-paragraph summary. **Default chosen:** 500 chars. This can be raised in a follow-up without a schema migration (Zod `max()` is a runtime check, not stored as metadata).

**Q4: Should `source_index.jsonl` be populated automatically by the Run Ledger, or manually by agents/tools?**
Automatically detecting which files changed requires hooking into `execute-handoff` or diffing checkpoints. Manual population (via a `write_run_event` call that includes a `files_modified` list) is simpler and avoids coupling. **Default chosen:** manual population for now; no automatic file-change detection in this plan.

**Q5: Should `ExecutionWorkspace` records be auto-created when `execute-handoff` spawns into a worktree, or always explicitly registered?**
The handoff flow already knows which directory it ran in (`Envelope.spawn.cwd` or equivalent). Auto-registering on handoff completion would mean no workspace is missed, but couples the Run Ledger to `execute-handoff` internals. Explicit registration via `register_execution_workspace` (agents call it before/after spawning) keeps the Run Ledger loosely coupled. **Default chosen:** explicit registration only; `execute-handoff` is not modified. If gaps appear in practice, a follow-on can add auto-registration as a non-breaking enhancement.

**Q6: Should `cleanup_policy = auto_on_merge` trigger automatic `git worktree remove`?**
Captured but not acted on in this plan. The CLI/MCP only record the policy; actual filesystem cleanup remains user-initiated. **Default chosen:** record only. Automation is a follow-on once the recording flow is proven.

**Q7: Where does the model/effort ladder configuration live?**
Hard-coding model names in `src/repair_policy.ts` would lock the engine to today's catalog. **Default chosen:** the ladder is a small `ModelLadderConfig` table that the engine accepts as input (Task 12, Step 1). The table's defaults can live in a config file once the engine is exercised; for now Tasks 12–13 use literal defaults inside their tests. No code change is required to swap models.

**Q8: When the variable-change rule and the trigger table disagree, which wins?**
Some triggers — `forbidden_file_touched`, `evidence_contradiction`, `test_modified_to_pass` — force a stop or mode change regardless of whether the caller varied other variables. **Default chosen:** Attempt 3 boundary → triggers → ladder → variable-change. The policy engine applies them in that order and returns at the first decisive rule. (The Attempt 3 boundary was hoisted ahead of triggers in commit `2871dec` so a failed/incomplete latest at `attempt_number ≥ 3` stops unconditionally — see §3.5.)

**Q9: Can a human bypass `stop_needs_human` and continue the automated loop?**
No — `evaluateRepairPolicy()` will keep emitting `stop_needs_human` while the conditions in §3.5 hold. A human can author a new `RepairAttempt` directly (the engine does not gate human-authored attempts; it only judges proposed automated ones). The engine does NOT auto-reset the attempt count: if the human's appended attempt carries `attempt_number ≥ MAX_STRUCTURED_ATTEMPTS`, the boundary still fires for any subsequent automated evaluation. The human carries the work forward by hand from there. This is intentional asymmetry — humans take responsibility, engines do not.

---

## Verification Checklist

After the base Run Ledger tasks (Tasks 1–9):

1. `git ls-files bin/.relayos/` → empty (no longer tracked)
2. `npm run typecheck` → clean, zero errors
3. `npm test` → full vitest suite green (the branch currently runs at 929/929; the 640+ baseline was from the pre-Run-Ledger branch tip)
4. `node dist/cli.js overseer run start --goal "test"` → prints `r_<ULID>`
5. `node dist/cli.js overseer run current` → JSON with `run.status === "active"`
6. `node dist/cli.js overseer run compact` → writes `continuation.json`
7. `node dist/cli.js overseer run complete` → prints confirmed, removes `active_run.json`
8. `node dist/cli.js overseer run list` → JSON array including completed run
9. `node dist/cli.js overseer run register-workspace --kind git_worktree --path /tmp/x --owner codex` → prints `w_<ULID>`
10. `node dist/cli.js overseer run list-workspaces` → JSON array including the registered workspace
11. `node dist/cli.js overseer run update-workspace <w_id> --status merged` → status transition recorded
12. MCP tool `read_current_run` (via `node dist/cli.js overseer context-pack`) → output contains "Active Run" section and "Active workspaces" section when both are populated
13. `appendConversationLog` test confirms write to explicit `projectRoot`, not CWD
14. `WORKSPACES.jsonl` round-trip: append two records with same `id` (different `updated_at`), `readExecutionWorkspaces` returns one record with the later `updated_at`

After the repair-layer tasks (Tasks 10–14):

15. **Failed-repair invariant:** for every test where the latest prior `RepairAttempt.result` is `"incomplete"` or `"failed"`, `evaluateRepairPolicy()` MUST return either (a) `decision: "stop_needs_human"`, OR (b) a proposed next attempt that differs from the latest attempt in at least one `RepairVariableChange` axis (`effort`, `model`, `provider`, `mode`, `scope`, `tests`, `reviewer`). Equivalently: after an `incomplete`/`failed` attempt, `decision === "allow_retry"` is permitted ONLY when the changed-variables set is non-empty. Locked in by `tests/repair_policy.test.ts`, including a property-style sweep that varies one axis at a time and asserts the engine treats each as a valid change.
16. **Machine-checkable decisions:** `evaluateRepairPolicy()` returns a `RepairPolicyDecision` for every documented input shape; `reason_codes.length >= 1` always.
17. **Markdown vs engine:** `docs/overseer/REPAIR_ESCALATION_POLICY.md` exists; its model-ladder table and stop-conditions section match the rules tested in `tests/repair_policy.test.ts`. If they drift, the test referencing the example fails.
18. **Compact guidance:** `tests/repair_guidance.test.ts` proves a 750-word default budget, a 1,200-word hard cap, and refusal of any output containing `\nuser:`, `\nassistant:`, or `<message>`.
19. **No raw transcript:** the guidance generator never reads or accepts raw conversation history — its input type is `GuidanceInputs` with structured `ReviewFinding`, `RepairAttempt[]`, and `EvidenceRef[]` only.
20. **No infinite same-model retry:** test case `attempt_2_with_identical_proposed_next_returns_stop_or_escalation`.
21. **Human approval preserved:** every emitted `RepairPolicyDecision` in Task 12's tests has `requires_human_approval === true`. There is no path in this batch by which a `DraftReply` reaches `approval_status: "approved"` without a human-authored append.
22. **No Python:** `git ls-files | grep '\.py$'` returns no new files for this plan; the repair engine and guidance generator are TypeScript only.

---

## Out of Scope

- No daemon, background process, or cloud sync.
- No automatic run archival or rotation (can be added later).
- No change to handoff envelope schema. **No breaking changes to existing MCP tools; this plan proposes 6 additive tools** (`write_run_event`, `read_current_run`, `read_current_task_ledger`, `update_task_ledger`, `register_execution_workspace`, `read_execution_workspaces`) — adding tools is still a surface change, just not a breaking one. Repair-layer CLI/MCP (Task 15) is **explicitly deferred** to a later plan; this plan ships only the schemas, storage helpers, policy engine, guidance generator, and Markdown contract.
- No automated workspace cleanup (`cleanup_policy` is recorded but not acted on).
- No auto-registration of workspaces from `execute-handoff`; agents register explicitly.
- No automatic file-change detection for `source_index.jsonl`.
- **No automatic agent-to-agent repair loop.** The policy engine drafts a decision and the guidance generator produces a compact message; **sending** that message requires a recorded human approval. There is no `auto_reply_policy` in this plan, even in the safe-review-only flavor described in §3.6 (future revision only).
- No merge, push, tag, release, or workspace cleanup as a consequence of repair policy decisions.
- **No Python.** The policy engine and guidance generator are TypeScript only. Python may be used as an *ad hoc offline analysis* tool, but never on the live decision path. Adding Python would split enforcement across runtimes and add test surface for zero benefit.
- No RTUI changes (the run ledger is CLI/MCP only; RTUI integration is a follow-on).
- No change to `tasks.jsonl` format or `TaskRecord` schema.
- No rewrite of git history to remove already-committed `bin/.relayos/` content.
- No merge of `feat/overseer-identity-phase1` or `feat/settings-redesign` — separate branches.
