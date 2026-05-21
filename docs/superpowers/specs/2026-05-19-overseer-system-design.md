# Overseer System: Identity, Memory, and Supervised Continuation

**Status:** Design approved — ready for implementation planning
**Date:** 2026-05-19
**Topic:** Overseer role definition, forced context injection, project-scoped storage model, memory system, project isolation, handoff scoping, memory privacy / Git tracking, and per-project autonomy (step/build mode).

---

## 1. Context

RelayOS exposes a coordinating AI called the **Overseer** through a React+Ink
terminal UI (RTUI), launched today by `bin/relays`. The Overseer talks to a
configured provider (Codex CLI, Claude CLI, GLM, or an API model), plans tasks,
creates handoff envelopes, and — on approval — launches Codex/Claude to do the
coding work.

Four problems motivate this design:

1. **The Overseer does not understand its own identity.** Regardless of model,
   and especially with GLM, it does not reliably grasp what it is, what a
   "handoff" or "audit" is, or what its operating loop should be. Investigation
   shows the role *is* documented (`docs/OVERSEER_WORKFLOW.md §1`) but that text
   is never injected into the provider's context. The Overseer receives project
   *state* (via `buildOverseerContext`) but is never told *who it is*.

2. **There is no project-memory system suitable for large, long-running work.**
   When the Overseer's conversation context is compacted or cleared, work cannot
   reliably continue. Logs exist (`conversation_log.jsonl`, `decisions.jsonl`,
   `handoff_results.jsonl`, `timeline.jsonl`, `tasks.jsonl`) but they are written
   ad hoc, there are no human-readable projected-state files beyond
   `CURRENT_STATE.md`/`NEXT_ACTION.md`, and there is no checkpoint/rollback model.

3. **Storage location is unsafe.** Memory currently resolves to
   `<cwd>/.relayos/`. When RelayOS is installed as an MCP server in an IDE, the
   MCP executable may live in a global npm prefix, an npx cache, or `node_modules`
   — none writable or stable for project memory — and an arbitrary working
   directory is not a reliable project root.

4. **Project boundaries are not enforced.** With the MCP server shared across
   multiple open projects, there is no hard guarantee that overseer memory
   operations are scoped to the correct project. Tasks can be confused, and a
   shared handoff directory (`~/.claude/handoff/`) can mix handoffs across
   projects.

This spec defines a coherent **Overseer system** that fixes all four.

### 1.1 What already exists (build on, do not rebuild)

- `relayos overseer` CLI surface: `status`, `context`, `handshake`, `recent`,
  `context-pack`, `summary`, `doctor`, `brief`, `note`, `next`, `decision`,
  `handoff-result`, `progress`, `branch`, etc.
- MCP read/write tools: `read_overseer_*`, `write_overseer_note`,
  `write_overseer_decision`, `write_handoff_result`, handoff tools
  (`create_handoff`, `read_latest_handoff`, `list_open_handoffs`, etc.).
- `.relayos/overseer/` per-project workspace with policy MD files and JSONL logs
  — today resolved relative to the working directory (this becomes the opt-in
  **project-local** mode; see §5).
- Handoff envelopes and the handoff audit log (`~/.claude/handoff/`,
  `write_audit_log`) — a mature, separate layer.
- `runChatTurn` (`src/chat.ts`) — the non-interactive per-turn engine entrypoint
  wired as `relayos chat-turn`.
- `buildOverseerContext` (`src/conversation.ts`) — injects project state into
  provider input.

This design is **additive** to data formats. It does not break existing log line
schemas, envelope schemas, or audit formats; it does not break existing MCP
tools. It adds optional fields (notably `project_id` / `project_root`) and
relocates where memory/config are stored (§5).

---

## 2. Goals and Non-Goals

### 2.1 Goals

- The Overseer reliably understands its identity, vocabulary, and operating loop
  on every turn, with any provider.
- Project memory and config are stored in a stable, project-scoped location —
  the RelayOS user-data directory by default, keyed by `project_id` — never in
  the MCP install location and never in the project repo by default.
- MCP tool calls resolve the project from an explicit or host-provided
  workspace, never from `process.cwd()` or the install location.
- A project-scoped memory system that survives context compaction: immutable
  event logs as ground truth, human-readable projected state as working memory,
  checkpoints for projected-state rollback.
- Hard project isolation: every operation resolves and verifies a project
  identity; cross-project memory and handoff access hard-stop.
- Handoffs and audit events are project-scoped: stamped with `project_id` /
  `project_root` and filtered to the current project by default.
- Storage is created with private filesystem permissions.
- The active project binding is visible to the operator for auditability.
- Project memory and config are private by default; raw memory and raw config
  never enter Git; sharing requires an explicit redacted export.
- Per-project autonomy: a conservative step mode (default) and an opt-in build
  mode that is a foreground, supervised, interruptible continuation loop.
- Rename the conversation UI command to `overseer`, keeping `relays` as a
  transition alias.

### 2.2 Non-Goals

- No background daemon, detached runner, or unattended orchestration.
- No writing project memory/config into MCP package install directories, npx
  caches, global `node_modules`, or an arbitrary working directory.
- No silent sharing of raw memory or raw config; no automatic commit of project
  runtime state.
- No multi-level overseer hierarchy (remains future direction per
  `docs/OVERSEER_HIERARCHY.md`).
- No **breaking** changes to handoff envelope, checkpoint (git), or audit log
  schemas. Additive optional fields are permitted — `project_id` and
  `project_root` are added to new handoff envelopes and audit events for project
  scoping (§8.4).
- No change to existing JSONL log line schemas (new optional fields only).
- No detached `overseer run` command — build mode is RTUI-driven only.
- No cross-repo or global shared memory — storage is always per-`project_id`.
- No new provider integrations.

---

## 3. Governance Reconciliation (approved)

The current policy files forbid build mode by a literal reading:
`FORBIDDEN_ACTIONS.md` ("no parallel mode / queue runner / sub-run
orchestration", "no daemon/background agent behavior") and `OPERATING_POLICY.md`
("Human-supervised operation only; no autonomous/background orchestration").

Build mode as designed here is **supervised continuation**, not autonomous
orchestration. The policy is updated to draw that line precisely. The following
wording is approved:

**Allowed (build mode):**
- Foreground supervised continuation loop.
- Visible streaming progress.
- User can interrupt at any time.
- Stops at hard approval boundaries.
- Stops on test failure, uncertainty, or scope change.

**Still forbidden:**
- Daemon / background runners.
- Detached execution while the user is not watching.
- Parallel project/worktree orchestration without explicit approval.
- Autonomous commits, releases, destructive actions, production/server changes,
  credential changes, or high-cost external API usage.

This wording is **product policy** and must be written into the tracked product
sources: `src/overseer/role.ts` (`OVERSEER_ROLE_TEXT`), the bundled default
policy templates (`src/overseer/templates/`), and `docs/OVERSEER.md` /
`docs/OVERSEER_WORKFLOW.md`. A project's *runtime* policy files (§9.2) are
generated copies and are **not** the committed source of truth. No code path may
implement continuation that runs outside an attended RTUI session.

The policy templates' existing "no format changes" rule is refined in the same
pass to "no **breaking** format changes; additive optional fields permitted",
consistent with §2.2 and §8.4.

---

## 4. Naming

| Command | Role | Change |
|---|---|---|
| `overseer` | Launches the conversation/coordination UI (RTUI). | **New** primary binary. |
| `relays` | Same as `overseer`. | Kept as a transition alias; removable later. |
| `relayos` | Independent CLI: handoffs, audit, MCP-packaged tasks, `relayos overseer <subcommand>` state inspection. | Unchanged. |

There is no collision: the `overseer` binary means *talk to the overseer*;
`relayos overseer <subcommand>` means *inspect/manage overseer state from the
CLI*. Both names refer to the same conceptual actor.

**Mechanics.** `bin/relays` is renamed to `bin/overseer`; a new `bin/relays` is a
thin two-line forwarder to `bin/overseer`. `package.json` `bin` gains an
`overseer` entry and keeps `relays`. No behavior changes — both launch the same
RTUI/CLI router.

---

## 5. Storage Model

RelayOS *code* and RelayOS *project memory* are different things and must live in
different places. This section defines where project memory and config are
stored and how the project is resolved.

### 5.1 The MCP install location is code-only

After a user installs RelayOS, the MCP server executable may live in any of:

- a global npm prefix (e.g. `~/.nvm/.../lib/node_modules/relayos-mcp`);
- an npx cache (e.g. `~/.npm/_npx/...`);
- a project's `node_modules`;
- a manually configured `dist/index.js` path in a Claude/Codex MCP config.

None of these are suitable for Overseer project memory: they are ephemeral,
shared across projects, deleted or replaced on upgrade, or unwritable. **The MCP
install location is code only. RelayOS must never store mutable project memory
or config there, and must never infer a user project from it.**

### 5.2 Two storage modes

| Mode | Where memory + config live | Default? |
|---|---|---|
| **user-data** | RelayOS user-data directory, keyed by `project_id` | Yes |
| **project-local** | `<project>/.relayos/`, with auto-managed `.gitignore` | No — advanced opt-in |

user-data mode is the default. project-local mode is an explicit opt-in
(`relayos init --project-local`) for users who deliberately want RelayOS state
beside their code.

### 5.3 The RelayOS user-data directory (default)

In user-data mode, all of a project's memory and config live under a
per-`project_id` directory inside the RelayOS user-data root. The user-data root
resolves as:

1. `$RELAYOS_HOME`, if set.
2. Otherwise the OS-standard data directory:
   - macOS: `~/Library/Application Support/RelayOS/`
   - Linux: `~/.local/share/relayos/`
   - Windows: `%APPDATA%/RelayOS/`
3. Portable fallback: `~/.relayos/` — used when an OS-standard data directory
   cannot be resolved.

Per-project storage root: `<user-data root>/projects/<project_id>/`.

### 5.4 Project-local storage (opt-in)

`relayos init --project-local` creates `<project>/.relayos/` and writes
`<project>/.relayos/config.json`. When `.relayos/config.json` is present, that
project is in project-local mode and its storage root is `<project>/.relayos/`.
project-local mode requires the auto-managed `.gitignore` of §9.4.

Projects that already have `.relayos/` (including the RelayOS source repo
itself) are project-local by this rule — backward compatible.

### 5.5 Resolution input — MCP vs CLI

The project is resolved from a *working directory*. Where that working directory
comes from depends on the caller, and the rules differ:

- **CLI / local interactive commands** (`overseer`, `relayos …`) may use
  `process.cwd()`.
- **MCP tool calls must NOT use `process.cwd()`.** The working directory is
  taken, in order:
  1. an explicit `working_dir` / `projectRoot` argument on the tool call;
  2. otherwise the MCP host/client-provided workspace root.
  - If neither is available, the tool call **hard-stops** with a clear error
    asking for an explicit project workspace.
- An MCP call must **never** infer a user project from: the MCP package install
  location, an npx cache, a global `node_modules`, the RelayOS source repo, the
  home directory, or an arbitrary `process.cwd()`.

Once a working directory is established, resolution proceeds per §5.6.

### 5.6 Project root and `project_id`

From the established working directory:

1. Upward-search for `.relayos/config.json`. If found → **project-local mode**;
   the project root is the directory containing `.relayos/`.
2. Otherwise → **user-data mode**; the project root is the git repository root
   if the working directory is inside one, else the working directory itself.
3. Canonicalize the project root with `realpath` (resolves symlinks).
4. `project_id = short_hash(canonical_project_root + git_remote)`, where
   `git_remote` is empty when the project is not a git repo. `project_id` is
   stable across working-directory changes within the same project.

### 5.7 Storage root layout

Both modes use the same layout under the resolved storage root:

```
<storage_root>/             user-data:      <user-data root>/projects/<project_id>/
│                           project-local:  <project>/.relayos/
├── IDENTITY.json
├── config.json
├── config.secret
└── overseer/               ← "the overseer directory" (contents detailed in §7)
    ├── PROJECT_BRIEF.md  OPERATING_POLICY.md  FORBIDDEN_ACTIONS.md  MODEL_POLICY.md
    ├── conversation_log.jsonl  decisions.jsonl  handoff_results.jsonl
    ├── timeline.jsonl  tasks.jsonl  verifications.jsonl
    ├── CURRENT_STATE.md  NEXT_ACTION.md  TODO.md  DECISIONS.md  HANDOFFS.md  CHECKPOINTS.md
    └── checkpoints/<checkpoint_id>/
```

### 5.8 Filesystem permissions

RelayOS storage holds operational state and may hold sensitive values. When
creating storage:

- directories (the storage root, `overseer/`, `checkpoints/`) are created with
  private permissions where the platform supports them — e.g. `0700`;
- `config.secret` and `config.json` are written with private permissions —
  e.g. `0600`;
- event logs and projected-state files are written without world-readable
  permissions;
- if the platform cannot enforce these permissions (e.g. Windows, certain
  filesystems), RelayOS **warns clearly** rather than failing silently.

### 5.9 What RelayOS must never write project memory to

RelayOS must never write project memory or config to:

- the MCP package install directory;
- an npx cache;
- a global `node_modules`;
- an arbitrary process working directory;
- the user project repository — in user-data mode (the default).

All project memory and config go to the resolved storage root (§5.7) and nowhere
else. The MCP server resolves the project per tool call (§5.5–§5.6), then
reads/writes only that project's storage root.

---

## 6. Identity: `OVERSEER_ROLE.md` and the 4-Layer Context Load

### 6.1 `OVERSEER_ROLE.md`

A new canonical identity document. It is **bundled with the tool**, not stored
per-project — identity is global and identical across every project the Overseer
runs against.

Because injection must never fail (a missing file would silently strip the
Overseer's identity), the canonical content is **embedded in the source** as an
exported string constant (`src/overseer/role.ts`, exporting `OVERSEER_ROLE_TEXT`).
A human-readable `docs/OVERSEER_ROLE.md` is kept in sync as the reference copy.
The engine injects the embedded constant; it never reads a file for Layer 1.

`OVERSEER_ROLE.md` content covers:

- **Identity & mission.** The Overseer is the coordinating agent in a RelayOS
  session. It plans, scopes, delegates via handoffs, and reviews evidence. It
  does not write code directly in most sessions.
- **Glossary.** Plain definitions of: handoff, handoff envelope, audit, audit
  log, checkpoint, event log, projected state, step mode, build mode, hard
  approval boundary.
- **Operating loop.** Read state → plan → create handoff → (approval) → execute
  → read result → verify/test → record → project state → next.
- **Hard boundaries.** The "still forbidden" list from §3, plus the stop
  conditions (test failure, uncertainty, scope change).
- **Modes.** What step mode and build mode mean and how the Overseer must behave
  in each.

### 6.2 The 4-layer context load

Every `chat-turn` prepends a fixed, ordered context bundle to the provider input,
ahead of the user message. This extends the existing `buildOverseerContext`.

| Layer | Content | Source | Per-project | Bound |
|---|---|---|---|---|
| 1 — Identity | `OVERSEER_ROLE_TEXT` | embedded constant | no — global | full text |
| 2 — Policy | `OPERATING_POLICY.md`, `FORBIDDEN_ACTIONS.md`, `MODEL_POLICY.md` | overseer directory (§5.7) | yes | full text, each ≤ 4 KB |
| 3 — Project | `PROJECT_BRIEF.md`, `CURRENT_STATE.md`, `TODO.md`, `NEXT_ACTION.md` | overseer directory (§5.7) | yes | full text, each ≤ 8 KB |
| 4 — Recent truth | last N decisions, last N timeline entries, last N handoff results | event logs | yes | decisions 5, timeline 8, results 3 |

Rules:

- Layer order is fixed: identity first, then policy, then project, then recent
  truth, then the user message.
- Layer 2 reads the project's *runtime* policy copies, which are generated from
  the bundled product templates (§9.2) and may be customized per project.
- Missing Layer 2/3 files degrade gracefully — the layer is omitted with a short
  `(file not found)` marker, never a hard error.
- Per-file size bounds prevent context blow-up; oversized files are truncated
  with a `…[truncated]` marker.
- The bundle is assembled identically for CLI providers (prepended to the scoped
  provider input) and API providers (placed in the system prompt / a leading
  `system` message).

This directly fixes Problem 1: the Overseer is told who it is and what its
vocabulary means on every single turn.

---

## 7. Memory Architecture

Event-sourcing. **Immutable append-only event logs are ground truth.**
**Human-readable projected state is working memory.** **Checkpoints enable
projected-state rollback.** Code rollback remains Git's responsibility.

### 7.1 The overseer directory

The overseer directory is `<storage_root>/overseer/` (§5.7). Its contents:

```
overseer/
│   ── runtime policy + project input ──
├── PROJECT_BRIEF.md              — human-edited input (NOT projected)
├── OPERATING_POLICY.md           — runtime copy, generated from template (§9.2)
├── FORBIDDEN_ACTIONS.md          — runtime copy, generated from template (§9.2)
├── MODEL_POLICY.md               — runtime copy, generated from template (§9.2)
│
│   ── event logs (append-only, engine-written, immutable ground truth) ──
├── conversation_log.jsonl        — exists; conversation turns
├── decisions.jsonl               — exists; decision events
├── handoff_results.jsonl         — exists; handoff execution results
├── timeline.jsonl                — exists; notes + approvals + blockers (typed)
├── tasks.jsonl                   — exists; task state changes
├── verifications.jsonl      NEW  — test / build / typecheck runs and results
│
│   ── projected state (human-readable, derived from logs, auto-refreshed) ──
├── CURRENT_STATE.md              — exists; auto-refreshed
├── NEXT_ACTION.md                — exists; auto-refreshed
├── TODO.md                  NEW  — work queue, projected from tasks.jsonl
├── DECISIONS.md             NEW  — readable decision log, from decisions.jsonl
├── HANDOFFS.md              NEW  — handoff index + results
├── CHECKPOINTS.md           NEW  — checkpoint index
│
│   ── checkpoints ──
└── checkpoints/<checkpoint_id>/   NEW  — meta.json + snapshot of projected files
```

`IDENTITY.json`, `config.json`, and `config.secret` live one level up, at the
storage root (§5.7). Existing operational files (e.g. `provider_cooldowns.json`)
are unaffected.

### 7.2 Event logs

Logs are written **automatically by the engine** (`runChatTurn`,
`execute-handoff`), never relying on the Overseer remembering to write. This is
what makes the system survive context compaction: a turn or result is recorded
before the Overseer's own context can be lost.

**Additive constraint.** Existing log files keep their existing line schemas.
The only genuinely new file is `verifications.jsonl`. New optional fields may be
added to existing files (old readers ignore them, old lines simply lack them):

- `timeline.jsonl` — add optional `kind: "note" | "approval" | "blocker"`
  (absent ⇒ `"note"`). This lets timeline absorb approvals and blockers without
  a new file.
- All NEW lines written by `recordEvent()` carry an optional `project_id` field
  (see §8). Existing/old lines that lack it are treated as "unverified, trust by
  location" — see §8.2.

`verifications.jsonl` line schema:

```json
{ "ts": "<ISO8601>", "project_id": "<id>", "kind": "test|build|typecheck",
  "command": "<string>", "passed": true, "summary": "<string>",
  "handoff_id": "<id|null>" }
```

**Event types and their files:**

| Event | File | Written when |
|---|---|---|
| conversation turn | `conversation_log.jsonl` | each `chat-turn` |
| decision | `decisions.jsonl` | Overseer records a decision |
| handoff result | `handoff_results.jsonl` | `execute-handoff` completes |
| note / approval / blocker | `timeline.jsonl` (typed) | turn events, `/approve`, detected blockers |
| task state change | `tasks.jsonl` | TODO item added / started / done / blocked |
| verification | `verifications.jsonl` | a test/build/typecheck run completes |

Handoff *lifecycle* events (created, launched) are captured by the handoff audit
log; overseer memory **references handoff IDs** and does not duplicate that log.
Referenced handoff IDs are verified to belong to the current project (§8.4).

### 7.3 Projected state

Projected-state MD files are **derived** from the event logs by a pure projection
function. They are the Overseer's fast-read working memory and the human's
audit/review surface.

| File | Projected from | Contents |
|---|---|---|
| `CURRENT_STATE.md` | all logs | git anchor, latest verification baseline, recent completions, in-progress |
| `TODO.md` | `tasks.jsonl` | ordered work queue with status per item |
| `DECISIONS.md` | `decisions.jsonl` | readable, dated decision list |
| `HANDOFFS.md` | handoff events + `handoff_results.jsonl` | index of handoffs, target/model, status, result summary |
| `NEXT_ACTION.md` | `tasks.jsonl` + last events | the single next action |

`PROJECT_BRIEF.md` is human-edited input and is never overwritten by projection.

**Refresh triggers.** `projectState()` runs at these lifecycle points:

- after a handoff completes;
- after a verification (test/build/typecheck) passes or fails;
- after a user approval;
- before the Overseer starts the next task (build mode).

Projection is **deterministic and idempotent**: same logs ⇒ same projected files.

### 7.4 Checkpoints and rollback

A **checkpoint** captures the projected state at a point in time so it can be
restored later. Code rollback is Git's job; checkpoints roll back *working
memory* only.

`meta.json` per checkpoint:

```json
{ "id": "<checkpoint_id>", "label": "<string>", "ts": "<ISO8601>",
  "git_sha": "<HEAD sha at checkpoint time>", "seq": <log position> }
```

- `createCheckpoint(label)` — copies current projected-state MD files into
  `checkpoints/<id>/`, records `git_sha` and `seq` (the count of log events at
  this time), appends a row to `CHECKPOINTS.md`.
- `rollbackToCheckpoint(id)` — restores the checkpoint's MD snapshot as the new
  projection **seed**, sets the **projection floor** to `checkpoint.seq`, and
  appends a `rollback` note to `timeline.jsonl`. Subsequent events project on
  top of the restored seed.

**Event-sourcing discipline.** Logs are never mutated or truncated. Rollback is
itself an appended, audited event. After a rollback, `projectState()` seeds from
the checkpoint snapshot and replays only events at or after the projection floor.
The projection floor is stored in `IDENTITY.json` (`projection_floor_seq`,
default `0`). The exact floor-tracking mechanics are finalized in the Phase 3
plan; the principle — immutable logs, restored seed, audited rollback event,
projection floor — is fixed here.

---

## 8. Project Isolation

Storage is per-`project_id` (§5). This section makes cross-project access
*detectable* and *fatal* rather than silently corrupting state, and extends the
same scoping to the handoff layer.

### 8.1 `IDENTITY.json`

On first use the engine writes `<storage_root>/IDENTITY.json`:

```json
{ "project_id": "<short hash>", "project_root": "<canonical absolute path>",
  "git_remote": "<remote url | null>", "storage_mode": "user-data | project-local",
  "created_at": "<ISO8601>", "projection_floor_seq": 0 }
```

`project_id` is computed per §5.6 and persisted here.

### 8.2 Verification on every operation

- Every NEW log line and every projected-state file header carries `project_id`.
- Before any memory read or write, the engine compares the resolved project's
  `project_id` (from `IDENTITY.json`) against the `project_id` stamped in the
  file/line being accessed.
- **Mismatch ⇒ hard stop** with a loud, specific error
  (`overseer memory belongs to a different project: expected <A>, found <B>`).
- **Migration tolerance.** Old log lines and pre-existing files that lack a
  `project_id` are treated as "unverified, trusted by location" — accepted (the
  file lives in the resolved project's storage root) but not identity-checked.
  Only an *explicit, conflicting* `project_id` triggers the hard stop. New writes
  always stamp `project_id`, so coverage grows over time.

### 8.3 MCP server scoping (project memory)

The RelayOS MCP server resolves the project per §5.5–§5.6 for each overseer
memory tool call, then reads/writes only that project's storage root (§5.9). If
it cannot unambiguously resolve exactly one project, the tool call fails with a
clear error rather than guessing. There is no global shared overseer memory.

### 8.4 Handoff and audit project scoping

Handoff envelopes and the handoff audit log may continue to live outside the
project (today: `~/.claude/handoff/`). But they must be tied to the resolved
project so a shared handoff directory cannot mix tasks across projects.

- Every handoff envelope and audit event created from an Overseer/project context
  **stamps `project_id` and `project_root`**. These are additive optional fields
  (§2.2) — no breaking schema change; old envelopes/readers are unaffected.
- `read_latest_handoff` and `list_open_handoffs`, when called in an
  Overseer/project context, **filter to the current project by default**.
- Listing handoffs across all projects is allowed **only** through an explicit
  global/admin mode (e.g. a `--global` flag), never by default.
- When project memory references a handoff ID, the engine **verifies that
  handoff's `project_id` matches the current project** before using it; a
  mismatch hard-stops (§8.2).

Affected surfaces: `create_handoff` / `create_handoff_from_template` /
`create_quick_handoff` (stamp), `write_audit_log` (stamp), `read_latest_handoff`
/ `list_open_handoffs` / `list_handoffs` (filter; `--global` opt-out).

### 8.5 Project binding visibility

The user must be able to audit which project RelayOS thinks it is managing.
`relayos overseer status`, `relayos overseer doctor`, and the RTUI settings
screen surface the active binding:

- `project_root`
- `project_id`
- `storage_mode` (user-data / project-local)
- `storage_root`
- **resolution source** — how the working directory was obtained: explicit
  `working_dir`, host workspace root, git root, or CLI `cwd`.

This makes misrouting visible to the operator, not just detectable by the engine.

---

## 9. Git Tracking and Memory Privacy

RelayOS *product files* are tracked in the RelayOS repository. *Project runtime
state* — memory and config — is private and never committed by default.

### 9.1 The RelayOS repository (product assets, tracked)

These product files belong to the RelayOS repository and are tracked in Git
normally:

- `src/overseer/role.ts` and `docs/OVERSEER_ROLE.md`;
- bundled/default policy templates (`src/overseer/templates/`);
- schema / migration code;
- CLI / RTUI / MCP implementation;
- docs and examples, including the design specs under `docs/superpowers/specs/`.

### 9.2 Product policy vs. runtime policy

There are two distinct kinds of policy file, and they must not be confused:

- **Product policy templates** — `src/overseer/templates/OPERATING_POLICY.md`,
  `FORBIDDEN_ACTIONS.md`, `MODEL_POLICY.md`. Tracked in the RelayOS repo. **The
  source of truth.** The §3 governance wording is committed here.
- **Runtime policy copies** — `<overseer dir>/OPERATING_POLICY.md` etc.,
  generated from the templates into a project's storage. Local, private, may be
  customized per project. **Not** the source of truth; never the committed
  policy change.

A policy change is made by editing the product template (and `role.ts` / docs)
and committing that. RelayOS may regenerate or refresh a project's runtime copy
from the template, but that generated file is not authoritative.

### 9.3 user-data mode — no project `.gitignore` mutation

In user-data mode (the default), memory and config are not written into the
project repository at all. RelayOS performs **no `.gitignore` mutation** in the
user's project. There is nothing in the repo to ignore.

### 9.4 project-local mode — auto-managed `.gitignore`

In project-local mode, `<project>/.relayos/` holds runtime state and must be
ignored. RelayOS creates or updates the project's `.gitignore` with a
clearly-marked managed block:

```
# >>> relayos managed (do not edit inside this block) >>>
.relayos/config.json
.relayos/config.secret
.relayos/IDENTITY.json
.relayos/overseer/
.relayos/cache/
.relayos/tmp/
# <<< relayos managed <<<
```

`config.json` is ignored because it may contain provider names, model choices,
API base URLs, token env-var names, encrypted token fields, and autonomy
settings — project operational state that must not be committed even when no raw
secret is present. `config.secret` and `IDENTITY.json` are likewise runtime
state.

Behavior of `ensureProjectGitignore`:

- **Idempotent** — reruns update the managed block in place; never duplicated.
- **Non-destructive** — only RelayOS's own marked block is created/updated; user
  entries elsewhere in `.gitignore` are never removed or modified.
- If `.gitignore` is absent, it is created.
- **If a file newly covered by the block is already git-tracked**, RelayOS warns
  the operator; it does **not** run `git rm` automatically (that is an explicit
  user action).

**Ordering rule.** In project-local mode, `ensureProjectGitignore()` **must run
before** writing `.relayos/config.json`, `.relayos/config.secret`,
`IDENTITY.json`, or any other `.relayos/` runtime file — so runtime state can
never be committed by accident. In user-data mode this ordering rule does not
apply (nothing is written into the project repo).

### 9.5 Redacted export

For teams that want shared state, a new command —
`relayos overseer export --redacted [--out <path>]` — produces a shareable,
redacted artifact. It redacts secrets and sensitive values, prefers summaries
over raw logs, writes only to an explicit opt-in path, and never auto-commits.
Raw memory and raw config are never shared without this explicit step.

### 9.6 Opt-in tracked files (template-generated)

Any RelayOS files a user *may* choose to track are generated from templates,
contain no raw runtime memory or config, and are opt-in:

```
.relayos/config.example.json
.relayos/overseer.policy.example.md
.relayos/project.example.md
docs/overseer/*.redacted.md
```

The source templates ship in the RelayOS repo (`src/overseer/templates/`).
RelayOS generates these example/redacted files on request; they are sample or
redacted artifacts, never raw runtime state.

---

## 10. Autonomy: Step and Build Mode

### 10.1 Configuration

`config.json` (located per the storage model, §5.7) gains an `overseer.autonomy`
field:

- Type: `"step" | "build"`.
- Default: `"step"`.
- The `/build` slash command toggles it and persists the change.

### 10.2 Step mode (default)

One `chat-turn` per user message: the Overseer replies, plans, and records the
handoff envelope (recording is side-effect-free; `auto_spawn: false`). The user
must `/approve` to launch Codex/Claude. After the handoff executes and its result
is recorded, the Overseer stops and waits for the user. This is exactly the
current human-supervised model.

### 10.3 Build mode (opt-in, foreground, supervised)

After a single `/approve`, the Overseer runs a continuation loop:

```
execute handoff → read result → record events → projectState()
  → run verification (test/build/typecheck) → record verification
  → if verification green AND TODO has a next item AND no hard boundary:
        create next handoff → (loop)
  → else: stop, surface state to the user
```

The loop is **foreground, streaming, and interruptible** — it runs inside the
active RTUI session, the user sees every step, and any keystroke interrupts it.
It is not a daemon and not detached (§3).

### 10.4 Hard approval boundaries (always, both modes)

The loop **always stops and waits for explicit `/approve`** before any of:
commit, release, tag, push, merge, destructive file operations, migrations,
production/server changes, credential changes, high-cost external API usage. The
planner already marks proposals `approval_required`; build mode honors that flag
without exception.

### 10.5 Stop conditions (build mode)

The loop also halts and returns control to the user on: a failed verification,
high planner uncertainty, or a detected task-scope change. It never "pushes
through" a failure.

### 10.6 Loop driver — Option A (RTUI-driven)

The loop is driven by the RTUI `Shell`. After a handoff executes, the Shell
issues the next `chat-turn` / `execute-handoff` cycle. The loop lives in the
interactive UI process. A detached `overseer run` command is explicitly **not**
implemented (it would be the forbidden detached runner).

---

## 11. The `overseer_memory.ts` Module

A new module, `src/overseer_memory.ts`, is the single home for memory logic.
Storage-path/mode/resolution lives in a `src/overseer/storage.ts` helper that
this module uses. Both `runChatTurn` and `execute-handoff` call this module; no
memory logic is duplicated.

Exported functions:

| Function | Purpose |
|---|---|
| `resolveProjectIdentity(input)` | Resolve the working directory per the caller (`input` is CLI — may use `cwd` — or MCP with explicit `working_dir` / host workspace; §5.5), then project root, mode, `project_id`, storage root, overseer dir, config path (§5.6–§5.7); load/create `IDENTITY.json`; in project-local mode run `ensureProjectGitignore` first (§9.4). |
| `verifyProjectIdentity(identity, file)` | Compare stamped `project_id`; throw a loud error on mismatch; tolerate missing (§8.2). |
| `ensureProjectGitignore(identity)` | project-local mode only — idempotently create/update the RelayOS managed `.gitignore` block (§9.4); non-destructive to user entries. |
| `recordEvent(identity, event)` | Append one event to the correct JSONL log, stamped with `project_id` and `ts`; create files/dirs with private permissions (§5.8). |
| `projectState(identity)` | Re-derive all projected-state MD files from the logs (deterministic, idempotent). |
| `createCheckpoint(identity, label)` | Snapshot projected state into `checkpoints/<id>/`, update `CHECKPOINTS.md`. |
| `rollbackToCheckpoint(identity, id)` | Restore a checkpoint's snapshot as the projection seed, set projection floor, append an audited `rollback` event. |
| `exportRedacted(identity, outPath)` | Produce a redacted, shareable artifact (§9.5); writes only to `outPath`, never commits. |
| `buildOverseerContextBundle(identity)` | Assemble the 4-layer context bundle (§6.2). Replaces/extends `buildOverseerContext`. |

---

## 12. Data Flow

**Step-mode turn:**

```
user message
  → overseer (RTUI Shell) → relayos chat-turn
  → resolveProjectIdentity (working dir → root → mode → project_id → storage root)
  → buildOverseerContextBundle (4 layers)
  → provider call → reply + action proposal
  → recordEvent(conversation_turn); recordEvent(handoff_created if any)
  → projectState()
  → RTUI shows reply + proposal; waits for /approve
/approve
  → relayos execute-handoff <id>   (handoff verified in-project, §8.4)
  → recordEvent(handoff_result); recordEvent(verification if run)
  → projectState()
  → stop
```

**Build-mode loop** is the same cycle, but after `projectState()` the Shell
evaluates §10.3: if green and a next TODO item exists and no hard boundary is
hit, it creates and executes the next handoff without re-prompting the user;
otherwise it stops.

---

## 13. Error Handling

| Condition | Behavior |
|---|---|
| MCP call with no explicit `working_dir` and no host workspace | Hard stop: "MCP call requires an explicit project workspace". |
| No project resolvable | Hard stop: "no RelayOS project found". |
| `project_id` mismatch (memory or handoff) | Hard stop: "belongs to a different project". |
| Resolved storage root unwritable | Hard stop with the path; do not fall back to cwd or the install dir. |
| `$RELAYOS_HOME` set but unwritable | Hard stop: report the path; no silent fallback. |
| Attempt to write memory to an install/npx/`node_modules`/cwd path | Hard stop (§5.9); this is a bug guard. |
| Storage permissions cannot be enforced on the platform | Warn clearly (§5.8); continue. |
| Missing Layer 2/3 file | Omit that layer with a `(file not found)` marker; continue. |
| Oversized Layer file | Truncate with `…[truncated]`; continue. |
| Corrupt JSONL line | Skip the line, emit a warning to stderr; projection continues. |
| `IDENTITY.json` missing | Create it (first-use); not an error. |
| `.gitignore` missing (project-local) | Create it with the managed block; not an error. |
| File newly covered by managed block already git-tracked | Warn the operator; do not auto-`git rm`. |
| `rollbackToCheckpoint` with unknown id | Hard stop: "checkpoint not found"; no state change. |
| Provider call fails | Existing `runChatTurn` error path; the failed turn is still recorded as a conversation event with an error marker. |
| Build-loop verification fails | Stop the loop, surface state, await the user (§10.5). |

---

## 14. Testing Strategy

All new behavior is covered by `vitest` tests (the project's existing test
runner). The RTUI uses `bun` tests (`npm run test:rtui`). All existing tests
stay green.

- **MCP resolution** — an MCP call rejects `process.cwd()`-only and install-dir
  paths; resolves from an explicit `working_dir` or a host workspace; hard-stops
  when neither is present.
- **Storage resolution** — defaults to user-data mode with no `.relayos/`;
  detects project-local mode when `.relayos/config.json` is present; honors
  `$RELAYOS_HOME`; resolves OS-standard and portable-fallback roots; never
  resolves a storage root inside an install/npx/`node_modules` path.
- **Identity** — `resolveProjectIdentity` computes a stable `project_id` across
  working-directory changes within one project; creates `IDENTITY.json`;
  `verifyProjectIdentity` hard-stops on a conflicting `project_id`; tolerates
  missing `project_id` (migration case).
- **Permissions** — storage dirs created `0700`, `config.secret` / `config.json`
  `0600`; a warning is emitted when permissions cannot be enforced.
- **Handoff scoping** — new envelopes and audit events carry `project_id` +
  `project_root`; `read_latest_handoff` / `list_open_handoffs` filter to the
  current project; global listing requires the explicit `--global` flag; a
  cross-project handoff ID hard-stops.
- **Project binding visibility** — `status` / `doctor` report `project_root`,
  `project_id`, `storage_mode`, `storage_root`, and the resolution source.
- **Context bundle** — `buildOverseerContextBundle` produces all 4 layers in
  order; omits missing files gracefully; truncates oversized files; identity
  layer is always present.
- **Event logs** — `recordEvent` appends correctly-shaped lines to the right
  file, stamped with `project_id`; `verifications.jsonl` schema is honored;
  `timeline.jsonl` typed `kind` round-trips.
- **Projection** — `projectState` is deterministic and idempotent; produces
  `TODO.md`, `DECISIONS.md`, `HANDOFFS.md`, refreshed `CURRENT_STATE.md` /
  `NEXT_ACTION.md`; corrupt log lines are skipped.
- **Checkpoint / rollback** — `createCheckpoint` snapshots projected files +
  `meta.json`; `rollbackToCheckpoint` restores the snapshot, sets the projection
  floor, appends an audited rollback event; logs are never mutated.
- **Git tracking** — in project-local mode `ensureProjectGitignore` creates the
  managed block (including `config.json` and `IDENTITY.json`), is idempotent, and
  never removes user entries; in user-data mode no `.gitignore` is touched.
- **Redacted export** — `export --redacted` redacts secrets, writes only to the
  explicit `--out` path, never commits.
- **Autonomy** — `overseer.autonomy` defaults to `"step"`; `/build` toggles and
  persists; build-mode loop stops at hard boundaries and on verification
  failure; step mode never auto-continues.
- **Naming** — `overseer` and `relays` both launch the RTUI/CLI router;
  `package.json` `bin` entries are correct.

---

## 15. Implementation Phasing

One spec; four phases. The implementation plan (produced by writing-plans) will
break these into bite-sized tasks. Phase 1 is deliberately small and ships the
immediate identity fix.

### Phase 1 — Identity fix (small, low-risk, ship first)

Phase 1 updates **bundled product sources/templates and docs** — the tracked
source of truth — and does not depend on the new storage model.

- `src/overseer/role.ts` with `OVERSEER_ROLE_TEXT`; `docs/OVERSEER_ROLE.md`
  reference copy.
- Bundled default policy templates in `src/overseer/templates/` carrying the §3
  governance wording, including the refined "no breaking format changes" rule.
- 4-layer context injection: extend `buildOverseerContext` →
  `buildOverseerContextBundle`, used by both CLI and API provider paths. Layer
  2/3 use the *current* overseer-dir resolution; the storage model arrives in
  Phase 2.
- Policy wording reconciliation (§3) committed into the product templates,
  `role.ts`, and `docs/OVERSEER.md` / `docs/OVERSEER_WORKFLOW.md`. Phase 1 may
  regenerate a project's runtime `OPERATING_POLICY.md` from the template, but
  the committed change is to the product source, not the runtime copy.
- `overseer` binary alias / naming cleanup (§4) — only if low-risk; otherwise
  deferred to its own small follow-up.

### Phase 2 — Storage model + memory + isolation + privacy

- `src/overseer/storage.ts`: resolution input rules (MCP vs CLI, §5.5), mode
  detection, user-data root resolution, `$RELAYOS_HOME`, project root +
  `project_id`, storage root + overseer dir, private filesystem permissions
  (§5.8).
- `src/overseer_memory.ts`: `resolveProjectIdentity`, `verifyProjectIdentity`,
  `ensureProjectGitignore`, `recordEvent`, `projectState`.
- Config relocation: `src/config.ts` resolves `config.json` from the storage
  root per mode (user-data default).
- `IDENTITY.json`; `verifications.jsonl`; `timeline.jsonl` typed `kind`.
- New projected-state files: `TODO.md`, `DECISIONS.md`, `HANDOFFS.md`.
- `ensureProjectGitignore` (project-local mode) runs before any runtime write
  (§9.4 ordering rule).
- Handoff/audit project scoping (§8.4): stamp `project_id` / `project_root` on
  new envelopes and audit events; filter `read_latest_handoff` /
  `list_open_handoffs`; explicit `--global` opt-out; verify referenced handoff
  IDs.
- Project binding visibility (§8.5): `relayos overseer status` / `doctor` and
  RTUI settings show `project_root` / `project_id` / `storage_mode` /
  `storage_root` / resolution source.
- `runChatTurn` and `execute-handoff` record events and call `projectState()`.

### Phase 3 — Checkpoints, rollback, and redacted export

- `createCheckpoint`, `rollbackToCheckpoint`, projection floor.
- `CHECKPOINTS.md`, `checkpoints/<id>/`.
- New `relayos overseer checkpoint` / `rollback` / `export --redacted`
  subcommands.
- Opt-in template-generated example files (§9.6), including
  `.relayos/config.example.json`.

### Phase 4 — Build mode

- `overseer.autonomy` config field; `/build` slash command.
- RTUI `Shell` continuation loop (Option A), hard boundaries, stop conditions.

---

## 16. Files Touched

| File | Change |
|---|---|
| `src/overseer/role.ts` | **New** — `OVERSEER_ROLE_TEXT` constant. |
| `src/overseer/templates/` | **New** — product policy/example/redacted templates. |
| `src/overseer/storage.ts` | **New** — resolution input + storage mode/path + permissions (§5). |
| `docs/OVERSEER_ROLE.md` | **New** — human-readable identity reference. |
| `src/overseer_memory.ts` | **New** — memory module (§11). |
| `src/conversation.ts` | Extend `buildOverseerContext` → `buildOverseerContextBundle` (4 layers). |
| `src/config.ts` | Resolve `config.json` from the storage root per storage mode. |
| `src/chat.ts` | `runChatTurn` records events, calls `projectState()`. |
| `src/index.ts` | MCP server: resolution input rules (§5.5); handoff-tool project filtering (§8.4). |
| `src/tools/create_handoff.ts` (+ template/quick variants) | Stamp `project_id` / `project_root` on new envelopes and audit events (§8.4). |
| `src/cli.ts` | `execute-handoff` records results/verifications, projects; new `overseer checkpoint`/`rollback`/`export` subcommands; `init --project-local`; `overseer status`/`doctor` show project binding (§8.5). |
| `src/rtui/Shell.tsx` | Build-mode continuation loop (Phase 4). |
| `src/rtui/commands/registry.ts` | `/build` slash command (Phase 4). |
| `src/rtui/screens/settings/` | Show the active project binding (§8.5). |
| `docs/OVERSEER.md`, `docs/OVERSEER_WORKFLOW.md` | Reflect build mode, storage model, memory system. |
| `bin/overseer`, `bin/relays` | Rename + alias forwarder (§4). |
| `package.json` | `bin` entry for `overseer`. |
| `tests/` | New vitest suites (§14). |

---

## 17. Out of Scope

- Multi-level overseer hierarchy (future direction).
- Detached `overseer run` / any background runner.
- Runtime workspace activation / `RELAYOS_RUNTIME_HOME` switching (a separate,
  pre-existing future item, distinct from the `RELAYOS_HOME` data-dir override).
- Parallel mode / worktree orchestration.
- New provider integrations.
- **Breaking** changes to handoff envelope, git checkpoint, or audit log schemas
  (additive optional project-scoping fields are in scope — §8.4).
- Relocating existing handoff storage out of `~/.claude/handoff/` — it stays;
  only project stamping/filtering is added.
- Cloud sync, remote backup, vector search of memory.
- Automatic migration of existing `<project>/.relayos/` state into user-data
  storage — existing project-local projects keep working as-is; any migration is
  an explicit, separate, operator-confirmed step.
