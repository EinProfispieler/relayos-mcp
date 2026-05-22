# relayos overseer

A gitignored local coordination workspace. Stores a running notes timeline and a "next action" pointer so Claude, Codex, and the human operator can recover current work state without relying on long chat context or terminal scrollback.

## Commands

```
relayos overseer status
relayos overseer context
relayos overseer handshake
relayos overseer recent
relayos overseer context-pack [--json] [--limit <1-20>]
relayos overseer run-preflight [--json]
relayos overseer summary [--json] [--limit <1-20>]
relayos overseer doctor [--json]
relayos overseer wake-instructions
relayos overseer init --project --dry-run
relayos overseer handoff-result add --run-id <id> --status <completed|failed|blocked|needs_review> --summary <text> [--tests-run <text> ...] [--test-result <text>] [--blocker <text> ...] [--needs-review] [--requires-user-approval]
relayos overseer handoff-result show --run-id <id> [--json]
relayos overseer handoff-results [--json] [--limit <1-20>]
relayos overseer note <text...>
relayos overseer next [text...]
relayos overseer start
relayos overseer mode
relayos overseer env
relayos overseer activate-runtime --dry-run --path <runtime-path> [--source <source-repo-path>] [--json]
relayos overseer runtime-check --path <runtime-path> [--source <source-repo-path>] [--json]
relayos overseer brief
relayos overseer branch <name>
relayos overseer progress [text...]
relayos overseer init-context
relayos overseer capabilities [--json]
relayos overseer memory-index [--json]
relayos overseer role-profile [--json]
relayos overseer decision <text...>
relayos overseer decisions [--json] [--limit <1-20>]
relayos overseer execute-handoff <handoff_id> [--dry-run] [--record-run-ledger]
relayos overseer plan-extract <handoff_id>
relayos overseer plan-answer <plan_id> <text...>
relayos overseer plan-task-handoff <plan_id> <task_id>
relayos overseer plan-execute-task <plan_id> <task_id>
relayos overseer plan-report <plan_id>
relayos overseer run <subcommand>          # Run Ledger CLI — see docs/superpowers/plans/2026-05-20-run-ledger-continuity-layer.md §5
```

### `overseer wake-instructions`

Prints only the RelayOS-managed AGENTS/project-instruction section for
overseer wake routing.

- Includes activation routing for `Overseer mode.`, `RelayOS Overseer mode.`,
  `进入 RelayOS Overseer。`, and `继续作为 RelayOS Overseer。`
- Includes strict startup safety contract:
  - first call `read_overseer_role_profile {}`
  - then follow `startup_sequence` exactly
  - do not start repo audits/implementation/docs review before role-profile recovery
  - do not edit/commit/push/tag/release without explicit approval
  - Codex App defaults for ordinary startup: `Approval = On request`, `Sandbox = Read only`
  - temporary `workspace-write` only for approved scoped implementation, validation-only build/test/typecheck needing writes, or future explicit project-init writes
  - do not grant broad/full access by default

### `overseer init --project --dry-run`

Read-only project-init preview for overseer AGENTS instructions.

- Detects current workspace path.
- Detects whether cwd is inside a git repo.
- Detects whether `AGENTS.md` exists at project root (git) or cwd (non-git).
- Prints exact `RELAYOS-MANAGED AGENTS SECTION` content that should be merged.
- Prints manual Codex App / Claude setup steps.
- Prints concise Codex App safe defaults matching wake-instructions output.
- Always ends with: `No files were written.`

### `overseer status`

Prints the current next action and the five most recent notes. If no state exists yet, prints a setup prompt.

`--json` prints the same core status data as stable machine-readable JSON.

### `overseer context`

Read-only context availability check for local `.relayos/overseer/` canonical files.

- `relayos overseer context` prints a compact file-availability summary.
- `relayos overseer context --json` returns `{ ok, workspace_path, files, missing, gitignored }`.
- Missing files are reported, not treated as fatal.

### `overseer handshake`

Read-only session protocol snapshot for overseer-bound clients.

- `relayos overseer handshake` prints protocol/session role, repo/workspace paths, context status, must-read files, next-action source, and safety reminders.
- `relayos overseer handshake --json` returns stable handshake metadata for automation clients.
- Missing context files mark the handshake as incomplete (`ok: false`) but do not write files.

For MCP clients, the canonical session-start sequence is `read_overseer_doctor` → `read_overseer_handshake`; treat `must_read`, `next_action_source`, `forbidden_actions`, and `requires_explicit_user_approval_for` as the session contract. The CLI `overseer handshake` command exposes the same data in human-readable and `--json` form for terminal use.

### `overseer recent`

Prints a compact read-only summary of current local overseer context for fast terminal recovery:

- project identity (one-line, from local `PROJECT_BRIEF.md` when available)
- current state anchor (from local current-state anchor when available, else latest git commit context)
- active branch/task
- next action
- current mode posture (serial default)
- runtime posture (switching inactive; `RELAYOS_RUNTIME_HOME` inspection-only)

Missing optional local files are shown as `not available` instead of failing.

`--json` prints stable machine-readable output with top-level fields `project`, `currentState`, `activeBranch`, `nextAction`, `mode`, `runtime`, `warnings` (always an array). Missing optional values degrade to `null` instead of crashing.

### `overseer context-pack`

Read-only curated continuity snapshot for non-MCP CLI workflows.

- `relayos overseer context-pack` prints a compact summary:
  project/current/next status, recent notes, recent decisions, recent handoff result evidence, boundaries, model policy,
  recommended prompt, and evidence links.
- `relayos overseer context-pack --json` returns the same context-pack
  payload shape used by `read_overseer_context_pack`.
- `--limit <1-20>` bounds `recent_notes`, `recent_decisions`, and `recent_handoff_results` (default `8`, max `20`).
- Missing local files are reported in `missing`; command remains read-only.
- No raw full chat transcript is returned.
- Context-pack handoff result evidence is read-only continuity data; it does not perform run automation.

### `overseer run-preflight`

Read-only future-run readiness check for scoped Rookie/handoff workflows.

- `relayos overseer run-preflight` prints a compact readiness summary.
- `relayos overseer run-preflight --json` prints deterministic machine-readable preflight output.
- This command is preflight only: it does not create a run, start agents, activate runtime, or mutate local state.
- Runner/queue/runtime execution are not active in current Core.

### `overseer summary`

Deterministic read-only session/migration summary assembled from existing local curated state.

- `relayos overseer summary` prints a compact human-readable summary with:
  context, current state, next action, recent decisions, recent handoff result evidence, recent notes, run-preflight snapshot, and a recommended next safe action prompt.
- `relayos overseer summary --json` returns stable machine-readable summary output.
- `--limit <1-20>` bounds `recent_notes`, `recent_decisions`, and `recent_handoff_results` (default `8`, max `20`).
- No model summarization is used.
- Command is read-only and does not create `.relayos/overseer/`.
- Summary evidence is read-only continuity data; it does not perform run automation.

### `overseer doctor`

Read-only local readiness diagnostic for overseer onboarding/migration sessions.

- `relayos overseer doctor` prints a compact checklist covering version visibility, cwd/workspace, local context completeness, recent notes/decisions, handoff result evidence status, context-pack/summary/run-preflight readiness, tracked `.relayos/overseer` files, and possible stale `dist/cli.js` build.
- `relayos overseer doctor --json` returns stable machine-readable output with:
  `ok`, `tool`, `workspace_path`, `version`, `context_complete`, `missing`,
  `recent_notes_count`, `recent_decisions_count`, `recent_handoff_results_count`, `handoff_results_available`, `run_preflight_ready`,
  `tracked_local_state_files`, `stale_build_possible`, `checks`,
  `recommended_next_action`, and `notes`.
- Command is diagnostics-only evidence readback and does not create, modify, or delete `.relayos/overseer/` files or run automation.

### `overseer handoff-result add/show` and `overseer handoff-results`

Local-first structured handoff result evidence primitives for future Rookie Mode lifecycle support.

- `relayos overseer handoff-result add` appends one result record to local `.relayos/overseer/handoff_results.jsonl`.
- Required flags for add: `--run-id`, `--status`, `--summary`.
- Allowed `--status` values in this slice: `completed`, `failed`, `blocked`, `needs_review`.
- Optional fields for add:
  - `--tests-run <text>` (repeatable)
  - `--test-result <text>`
  - `--blocker <text>` (repeatable)
  - `--needs-review`
  - `--requires-user-approval`
- `relayos overseer handoff-results [--json] [--limit <1-20>]` reads latest bounded result records (default `8`).
- `relayos overseer handoff-result show --run-id <id> [--json]` reads records for one run id.
- MCP parity tools:
  - `write_handoff_result` appends one local structured handoff result record.
  - `read_handoff_results` reads latest bounded local structured handoff result records.
  - `read_handoff_result` reads local structured handoff result records for one `run_id`.
- Read commands are local and read-only; missing file/workspace returns empty results and does not create `.relayos/overseer/`.
- This records result evidence only. It does not start agents, create a queue, or run lifecycle automation.

### `overseer note <text...>`

Appends a timestamped note to `.relayos/overseer/timeline.jsonl`. The text is all arguments joined with spaces.

```
$ relayos overseer note blocked waiting for CI
note recorded: blocked waiting for CI
```

Exits 1 with usage if no text is given.

### `overseer next [text...]`

**With arguments:** overwrites `.relayos/overseer/next_action.md` with the given text.

```
$ relayos overseer next deploy the patch after green CI
next action set: deploy the patch after green CI
```

**Without arguments:** reads and prints the current next action, or reports that none is set.

```
$ relayos overseer next
deploy the patch after green CI
```

### `overseer brief`

Prints a concise startup brief: project identity, current state, release/forbidden-action policy, product direction, current next action, latest git commit, and a local-data-safety reminder. Reads canonical context files from `.relayos/overseer/`; missing files are shown as `(missing — file not found in .relayos/overseer/)`. Exits 0 even when all files are absent. Takes no arguments — exits 1 with usage if any are given.

`--json` prints the same data as stable machine-readable JSON.

### `overseer start`

Prints the RelayOS banner, prints the current overseer brief, and emits explicit startup guidance:

- serial mode is the default
- parallel mode is future/opt-in and is not automatically enabled

This command is intentionally safe and read-only for orchestration: it does not launch Codex/Claude sub-runs, does not create branches/worktrees, and does not execute queue or parallel runners.

`--json` prints the same startup safety/mode state as stable machine-readable JSON.

### `overseer mode`

Prints the current execution mode guidance for overseer orchestration:

- current/default mode is serial
- write tasks are processed one at a time
- parallel mode is future/opt-in and is not automatically enabled

This command is read-only and does not change state, create config files, launch sub-runs, or create branches/worktrees.

`--json` prints the same mode information as stable machine-readable JSON.

### `overseer env`

Prints overseer environment boundaries for the current session:

- current working directory
- whether `RELAYOS_RUNTIME_HOME` is set
- whether runtime workspace is configured

It also explains current behavior and future intent:

- today, `.relayos/` paths resolve relative to the current working directory
- when `RELAYOS_RUNTIME_HOME` is set, it is detected for inspection only
- runtime workspace switching is not active yet
- production runtime state should stay outside the RelayOS source repo

This command is read-only and does not create directories, write files, or change state.

`--json` prints the same environment boundary information as stable machine-readable JSON.

### `overseer activate-runtime --dry-run --path <runtime-path> [--source <source-repo-path>] [--json]`

Read-only activation safety check for a proposed runtime workspace path.

- Requires `--dry-run` and `--path`.
- `--source` defaults to the current working directory.
- Reports `allow` / `warn` / `block` based on path safety checks.
- `block` when the proposed runtime path is inside the source repo.
- `block` when the proposed runtime path appears git-tracked.
- `warn` when the proposed runtime path does not exist.
- `warn` when `RELAYOS_RUNTIME_HOME` is set and differs from `--path`.
- Never activates runtime switching.
- Never writes files, creates directories, moves state, or changes `.relayos/` resolution.
- Human and JSON output both explicitly report that no files were written and runtime switching is not active.

`--json` returns the same decision report in machine-readable form.

### `overseer runtime-check --path <runtime-path> [--source <source-repo-path>] [--json]`

Read-only alias for `overseer activate-runtime --dry-run ...` with equivalent safety checks and output.

### `overseer branch <name>`

Sets the active branch/task name by writing to `.relayos/overseer/branches/active/brief.md`. Overwrites any previous value.

```
$ relayos overseer branch "add auth middleware"
active branch set: add auth middleware
```

Exits 1 with usage if no name is given.

### `overseer progress [text...]`

**With arguments:** appends a timestamped entry to `.relayos/overseer/branches/active/progress.md`.

```
$ relayos overseer progress tests passing, moving to review
progress recorded: tests passing, moving to review
```

**Without arguments:** reads and prints all progress entries, or reports that none exist.

```
$ relayos overseer progress
[2026-05-14T10:00:00.000Z] tests passing, moving to review
```

Exits 0 in both cases. The branch does not need to be set before recording progress.

### `overseer init-context`

Creates missing canonical context stub files under `.relayos/overseer/` (`PROJECT_BRIEF.md`, `CURRENT_STATE.md`, `RELEASE_POLICY.md`, `FORBIDDEN_ACTIONS.md`, `PRODUCT_DIRECTION.md`, plus `branches/active/{brief,progress}.md` and `planned/{enterprise_server,web_panel}.md`). Skips files that already exist — safe to run multiple times.

If legacy lowercase context files are detected (e.g. `project_brief.md`, `current.md`) and their canonical UPPERCASE counterparts do NOT exist, the legacy files are **renamed** to canonical (content preserved). If both casings physically coexist (case-sensitive filesystems only), the legacy file is left untouched and a note is written to stderr.

Exits 0 on success. Output reports each `renamed legacy:` / `created:` / `note:` line, or `overseer context already complete — no files created` when nothing changed.

### `overseer capabilities [--json]`

Read-only. Returns the static overseer capability policy: allowed-by-default actions, actions requiring explicit approval, forbidden actions, and known RelayOS CLI/MCP surfaces. Mirrors the MCP tool `read_overseer_capabilities`. No filesystem side effects.

### `overseer memory-index [--json]`

Read-only. Returns a live-generated compact categorized snapshot of overseer continuity state assembled from local curated sources only (recent notes, decisions, handoff results, next-action, current state). Mirrors the MCP tool `read_overseer_memory_index`. Never creates an index file on disk.

### `overseer role-profile [--json]`

Read-only. Returns the static shared overseer role profile: role identity, activation phrases, startup read sequence, delegation policy, reporting style, and safety policy. Mirrors the MCP tool `read_overseer_role_profile`. No filesystem side effects.

### `overseer decision <text...>` and `overseer decisions [--json] [--limit <1-20>]`

Local-first decision record primitives, parallel to `note` / `recent` but for *decisions* rather than progress notes.

- `relayos overseer decision <text...>` appends a timestamped decision to `.relayos/overseer/decisions.jsonl`. Empty/whitespace-only text is rejected. MCP parity: `write_overseer_decision`.
- `relayos overseer decisions [--json] [--limit <1-20>]` reads the latest bounded decision records (default `8`). MCP parity: `read_overseer_decisions`.

### `overseer execute-handoff <handoff_id> [--dry-run] [--record-run-ledger]`

Launches Codex/Claude for a previously-recorded handoff envelope (from `~/.claude/handoff/envelopes/`). Provider/model are read from the envelope; failover to a backup provider is automatic when the primary CLI is missing or exits non-zero.

- `--dry-run` prints the rendered `launch_command` and exits without spawning. The flag may appear before OR after the handoff id.
- `--record-run-ledger` opts in to Run Ledger auto-record for this execution (default OFF; also enabled by `RELAYOS_RUN_LEDGER_AUTO_RECORD=1`). When opted in AND a run is active, appends a `SourceIndexEntry` per `allowed_files` entry and one `ExecutionWorkspace` record. See [`docs/superpowers/plans/2026-05-20-run-ledger-continuity-layer.md`](superpowers/plans/2026-05-20-run-ledger-continuity-layer.md) for the full Run Ledger surface.

Final status (`completed` / `failed`) is also appended to `.relayos/overseer/handoff_results.jsonl`.

### `overseer plan-*` subcommands

Project-plan lifecycle (used by the RTUI `/proceed` flow and reachable directly from the CLI):

- `relayos overseer plan-extract <handoff_id>` — parses the `PROJECT_PLAN` block from a completed plan handoff and persists the structured plan into `.relayos/overseer/plans/<plan_id>.json`. Emits a `@@RELAYOS_PLAN@@` JSON line for harness parsing.
- `relayos overseer plan-answer <plan_id> <text...>` — appends an answer to an open plan question.
- `relayos overseer plan-task-handoff <plan_id> <task_id>` — creates a handoff envelope for one task within a plan, sized by the task's declared target/model/effort/mode.
- `relayos overseer plan-execute-task <plan_id> <task_id>` — creates *and executes* the task handoff, with up to 2 fix-retries on failure. Honors `--record-run-ledger` / `RELAYOS_RUN_LEDGER_AUTO_RECORD=1` opt-in.
- `relayos overseer plan-report <plan_id>` — renders a human-readable progress report for the plan.

### `overseer run <subcommand>` (Run Ledger CLI)

Parent dispatcher for the Run Ledger / Continuity Layer commands: `start`, `current`, `resume`, `compact`, `complete`, `abandon`, `list`, `register-workspace`, `list-workspaces`, `update-workspace`. See [`docs/superpowers/plans/2026-05-20-run-ledger-continuity-layer.md`](superpowers/plans/2026-05-20-run-ledger-continuity-layer.md) §5 for the full surface, schemas, and storage layout.

## Storage

All overseer state lives under `<cwd>/.relayos/overseer/` (gitignored). The directory is resolved relative to the current working directory, so coordination state stays in the target project, not the RelayOS source tree.

**Append-only / overwritten by CLI commands:**

| Path | Written by | Shape |
|---|---|---|
| `timeline.jsonl` | `overseer note` | `{"ts":"<ISO>","text":"…"}` per line |
| `NEXT_ACTION.md` | `overseer next <text>` | plain text, overwritten |
| `decisions.jsonl` | `overseer decision` | `{"ts":"<ISO>","text":"…"}` per line |
| `handoff_results.jsonl` | `overseer handoff-result add` | structured result record per line |
| `branches/active/brief.md` | `overseer branch <name>` | plain text, overwritten |
| `branches/active/progress.md` | `overseer progress <text>` | timestamped lines, append-only |

**Human-edited context (canonical UPPERCASE names):**

`PROJECT_BRIEF.md`, `CURRENT_STATE.md`, `OPERATING_POLICY.md`, `FORBIDDEN_ACTIONS.md`, `MODEL_POLICY.md`. Missing files are reported by `overseer context` / `handshake` / `doctor` but never block command execution.

For backwards compatibility with older workspaces, `status`, `recent`, and `brief` also fall back to lowercase legacy names (`project_brief.md`, `current.md`, `release_policy.md`, `forbidden_actions.md`, `product_direction.md`) when the canonical UPPERCASE file is absent. Prefer UPPERCASE for new work; the lowercase aliases are retained only until the `init-context` CLI is rewritten to stub the canonical names.

Production runtime state — coordination notes, sub-run outputs, generated reports, operational logs for non-RelayOS projects — belongs outside the source repo entirely. See [docs/OVERSEER_WORKFLOW.md](OVERSEER_WORKFLOW.md) § "Source repo vs. runtime workspace" for the full treatment; `relayos overseer activate-runtime --dry-run` is the read-only safety check for proposing a runtime path.

## Exit codes

| Code | Condition |
|---|---|
| `0` | Success. |
| `1` | Missing required argument or unknown subcommand. |

## Non-goals

- No cloud sync and no cloud/server-side MCP surface.
- No background runner, daemon, detached runner, or autonomous runtime. (Build
  mode is foreground, supervised, interruptible continuation only — see
  `docs/OVERSEER_WORKFLOW.md` § "Step and build mode".)
- No structured query, search, or pagination of notes.
- No multi-project or cross-repo scope — storage is always project-local.
- No encryption or access control — treat as local scratch space.

## See also

- [`docs/OVERSEER_WORKFLOW.md`](OVERSEER_WORKFLOW.md) — Overseer role, serial vs parallel mode, model selection, safety rules, and source/runtime separation.
- [`docs/OVERSEER_RUNTIME_PLAN.md`](OVERSEER_RUNTIME_PLAN.md) — staged migration plan for moving to a separate production runtime workspace.
- [`docs/OVERSEER_HIERARCHY.md`](OVERSEER_HIERARCHY.md) — future multi-level overseer design direction (not current implementation).
- [`docs/CHECKPOINTS.md`](CHECKPOINTS.md) — captures full git state before risky handoffs.
- [`docs/DIFF_RISK.md`](DIFF_RISK.md) — classifies the working tree before `git commit`.
- [`docs/LAUNCH.md`](LAUNCH.md) — prints the `codex exec` command for the newest open handoff.
