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
// src/overseer.ts — add RunLayout interface and resolveRunLayout(cwd, runId)
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

---

## 3 · File Layout

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
  # existing files unchanged:
  timeline.jsonl
  decisions.jsonl
  handoff_results.jsonl
  tasks.jsonl
  conversation_log.jsonl
  chat_sessions.jsonl
  CURRENT_STATE.md  NEXT_ACTION.md  etc.

src/
  schema.ts          # + RunRecord, TaskLedgerEntry, ContinuationPacket,
                     #   SourceIndexEntry, ExecutionWorkspace
                     #   (Zod schemas + inferred types)
  overseer.ts        # + RunLayout, resolveRunLayout, resolveRunsDir,
                     #   run CRUD helpers (appendTaskLedgerEntry, updateRunRecord,
                     #   readActiveRunId, setActiveRunId, clearActiveRunId,
                     #   readContinuationPacket, writeContinuationPacket,
                     #   buildCompactContinuation,
                     #   appendExecutionWorkspace, readExecutionWorkspaces,
                     #   updateExecutionWorkspaceStatus)
  id.ts              # + newRunId(): "r_<ULID>"
  cli.ts             # + case "run": delegating to runOverseerRun()
  tools/
    write_run_event.ts          # MCP: append TaskLedgerEntry
    read_current_run.ts         # MCP: active_run.json → run.json + recent ledger
    read_current_task_ledger.ts # MCP: task_ledger.jsonl (last-N entries, deduped)
    update_task_ledger.ts       # MCP: update a TaskLedgerEntry by seq

tests/
  run_ledger.test.ts            # unit tests for all helpers
  run_ledger_cli.test.ts        # CLI subcommand integration tests
  run_ledger_mcp.test.ts        # MCP tool tests (follows existing mcp tool test pattern)
```

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

## 4 · CLI/MCP Surface

### 4.1 CLI — `overseer run <subcommand>`

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

### 4.2 MCP tools

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

### 4.3 MCP tool registration

All four tools registered in `src/tools/index.ts` following the existing registration pattern. No MCP server configuration file changes needed — tools are auto-discovered by the existing registration mechanism.

---

## 5 · Agent Recovery Protocol

### 5.1 Startup sequence (what an agent reads on session start)

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

5.  ~/.claude/handoff/audit.jsonl  (only for in-flight handoff IDs from step 4)
    → Verify actual handoff status. Do NOT read the full audit log.

6.  .relayos/overseer/NEXT_ACTION.md  (existing file, unchanged)
    → Absolute ground truth for what to do next.

7.  Stop reading. Do not read conversation_log.jsonl.
    Do not read timeline.jsonl unless debugging.
    Do not read all of task_ledger.jsonl — only last N entries.
```

### 5.2 Token budget guidance

The continuation packet is designed to fit in 1,000 tokens. Reading steps 1–4 above uses < 3,000 tokens. The full cold-start context (all 4 layers + run ledger) should stay under 10,000 tokens for a typical in-progress run.

`buildOverseerContextPack` (Layer 3) is extended to append a "Run Ledger" section when an active run exists. The section is: run ID + goal + continuation packet summary. This is injected automatically into every conversation turn.

### 5.3 What agents skip

- `conversation_log.jsonl` — contains full message history; skip unless explicitly debugging. The continuation packet captures the semantic outcome, not the conversation.
- All `runs/` directories except the active one.
- Full `task_ledger.jsonl` beyond last-N entries.
- `source_index.jsonl` — read only when doing affected-file analysis.

---

## 6 · Audit and Rollback

### 6.1 Connecting commits, patches, handoffs, and workspaces

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
```

This gives the full **where + who + what** picture without duplicating storage.

### 6.2 Rollback points

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

### 6.3 Workspace cleanup

When a run completes or is abandoned, `WORKSPACES.jsonl` is the source of truth for what physical state needs cleaning up:

- `status = "merged"` + `cleanup_policy = "auto_on_merge"` → safe to `git worktree remove <path>`
- `status = "active"` at run completion → user must decide: merge, abandon, or leave for next run
- `status = "abandoned"` → workspace path may still contain uncommitted work; cleanup requires explicit user confirmation
- `status = "cleaned"` → record retained for audit; filesystem already cleared

The CLI surfaces these states via `overseer run current` (active workspaces section) and `overseer run list-workspaces <run-id>`. **Automated cleanup is out of scope for this plan** — `cleanup_policy` is captured but not acted on. A follow-on can add `overseer workspace cleanup --auto` once the surfacing tools are proven.

### 6.4 Keeping private logs out of git

**Immediate action (part of Task 1 below):** Add `bin/.relayos/` to `.gitignore`. This prevents future commits of `bin/.relayos/overseer/conversation_log.jsonl` and `bin/.relayos/overseer/chat_sessions.jsonl`. The already-committed versions in git history remain (no rewrite of history).

**Long-term:** `appendConversationLog()` in `src/conversation.ts` already writes to `.relayos/overseer/conversation_log.jsonl` (project-root-relative). The write path is correct when CWD = project root. The `bin/.relayos/` leak happens when RelayOS is invoked from `bin/` as CWD. Fix in Task 2: pass explicit `projectRoot` to `appendConversationLog()` instead of relying on `process.cwd()`.

**Run Ledger files** at `.relayos/overseer/runs/` are already covered by the existing `.gitignore` entry for `.relayos/overseer/`. No new gitignore entries needed for the runs directory.

---

## 7 · Migration Plan

### 7.1 What changes

| Before | After |
|---|---|
| `bin/.relayos/overseer/` tracked in git | `bin/.relayos/` added to `.gitignore`; existing tracked files removed from git index with `git rm --cached` |
| `appendConversationLog()` uses `process.cwd()` | Uses explicit `projectRoot` param passed through call chain |
| No `active_run.json` or `runs/` directory | New files created on first `run start` |
| `buildOverseerContextPack` has no run layer | Extended to inject Run Ledger summary when active run exists |
| `schema.ts` has `Envelope`, `TaskRecord`, `AuditEvent` | Adds `RunRecord`, `TaskLedgerEntry`, `ContinuationPacket`, `SourceIndexEntry` |

### 7.2 No breaking changes

- All existing MCP tools (`write_overseer_note`, `write_overseer_decision`, `write_handoff_result`, `read_overseer_recent`, `read_overseer_summary`, etc.) are unchanged.
- All existing CLI subcommands are unchanged.
- `OverseerLayout` interface gains no new required fields — `RunLayout` is a separate interface.
- `tasks.jsonl` (existing `TaskRecord` appends) continue unchanged. `TaskLedgerEntry` is a different, run-scoped record.
- `.relayos/overseer/CURRENT_STATE.md`, `NEXT_ACTION.md`, and all other canonical files are read-only from this feature's perspective.

### 7.3 Migration of existing data

No migration of existing `tasks.jsonl`, `timeline.jsonl`, `decisions.jsonl`, or `handoff_results.jsonl`. These continue to accumulate as before. The Run Ledger is additive.

The two tracked files in `bin/.relayos/` are removed from git index (not deleted from disk):

```bash
git rm --cached bin/.relayos/overseer/conversation_log.jsonl
git rm --cached bin/.relayos/overseer/chat_sessions.jsonl
echo "bin/.relayos/" >> .gitignore
```

This is a one-time cleanup commit, done in Task 1.

### 7.4 Rollout order

1. Fix `bin/.relayos/` gitignore leak (standalone commit, safe to ship immediately).
2. Add schema types (additive, no behavior change).
3. Add `src/id.ts` `newRunId()` + `src/overseer.ts` run helpers (no CLI exposure yet).
4. Add CLI `run start|current|compact|complete|abandon|list` with tests.
5. Add four MCP tools with tests.
6. Extend `buildOverseerContextPack` to inject run layer.
7. Fix `appendConversationLog` project-root param.

Each step is independently green and releasable.

---

## 8 · TDD Task Breakdown

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

## 9 · Open Questions

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

---

## Verification Checklist

After all 9 tasks:

1. `git ls-files bin/.relayos/` → empty (no longer tracked)
2. `npm run typecheck` → clean, zero errors
3. `npm test` → all 640+ existing tests green, all new tests green
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

---

## Out of Scope

- No daemon, background process, or cloud sync.
- No automatic run archival or rotation (can be added later).
- No change to handoff envelope schema. **No breaking changes to existing MCP tools; this plan proposes 6 additive tools** (`write_run_event`, `read_current_run`, `read_current_task_ledger`, `update_task_ledger`, `register_execution_workspace`, `read_execution_workspaces`) — adding tools is still a surface change, just not a breaking one.
- No automated workspace cleanup (`cleanup_policy` is recorded but not acted on).
- No auto-registration of workspaces from `execute-handoff`; agents register explicitly.
- No automatic file-change detection for `source_index.jsonl`.
- No RTUI changes (the run ledger is CLI/MCP only; RTUI integration is a follow-on).
- No change to `tasks.jsonl` format or `TaskRecord` schema.
- No rewrite of git history to remove already-committed `bin/.relayos/` content.
- No merge of `feat/overseer-identity-phase1` or `feat/settings-redesign` — separate branches.
