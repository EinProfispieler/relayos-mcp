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
relayos overseer init-context
relayos overseer branch <name>
relayos overseer progress [text...]
```

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

#### MCP client bootstrap rule

For Claude/Codex/other MCP clients, call `read_overseer_doctor` then
`read_overseer_handshake` as the canonical session-start bootstrap
sequence.
Current overseer MCP surface for this bootstrap flow:

- `read_overseer_bootstrap_prompt` (optional ready-to-use startup prompt helper)
- `read_overseer_handshake` (canonical bootstrap)
- `read_overseer_context_pack` (optional curated continuity pack)
- `read_overseer_summary` (optional deterministic read-only session summary)
- `read_overseer_run_preflight` (optional read-only future-run readiness check)
- `read_overseer_doctor` (optional read-only overseer readiness diagnostics)
- `write_overseer_decision` (optional local decision record append)
- `read_overseer_decisions` (optional read-only decision record readback)
- `write_handoff_result` (optional local structured handoff result append)
- `read_handoff_results` (optional read-only bounded handoff result readback)
- `read_handoff_result` (optional read-only handoff result readback by `run_id`)
- `write_overseer_note` (optional local progress note append)
- `read_overseer_recent` (optional read-only compact session readback)

- A separate `read_overseer_context` MCP tool is intentionally not
  required; handshake already includes context completeness, missing
  files, and required paths.
- Optionally call `read_overseer_bootstrap_prompt` to retrieve a
  read-only startup prompt and recommended first calls.
- Optionally call `read_overseer_context_pack` for a compact read-only
  continuity pack (project/current/next + recent notes/decisions + boundaries + evidence links).
- If `ok` or `context_complete` is false, report missing files and ask
  the user whether to proceed.
- Treat `must_read`, `next_action_source`, `forbidden_actions`, and
  `requires_explicit_user_approval_for` as the session contract.
- Use `write_overseer_note` only after handshake when you need to append
  local gitignored timeline notes; it is optional.
- Use `read_overseer_recent` only after handshake when you need a
  read-only compact view of local overseer state and recent notes.
- Do not assume RelayOS is a daemon, autonomous agent, or hard security
  sandbox, runtime activator, or automatic orchestrator.
- Do not proceed with forbidden actions without explicit user approval.

Minimal copy-paste prompt:

`Call read_overseer_doctor first, then read_overseer_handshake. If handshake ok/context_complete is true, follow the returned session contract. If incomplete, report missing files before acting.`

#### MCP smoke verification

After `npm run build`, restart MCP clients so they reload
`dist/index.js`. RelayOS MCP uses the configured stdio entrypoint and is
not a daemon.

1. Confirm RelayOS tools are visible in the MCP client.
2. Call `read_overseer_doctor {}`.
3. Call `read_overseer_handshake {}`.
4. If `ok` or `context_complete` is false, report `missing` and ask the user before proceeding.
5. Call `read_overseer_recent { "limit": 5 }`.
6. Optionally call `write_overseer_note { "text": "smoke: connected via MCP" }`.
7. Call `read_overseer_recent { "limit": 5 }` again and confirm the note appears.

Safety boundaries remain: local-only state, no daemon, no automatic
orchestration, no runtime activation, no security sandbox, and
forbidden actions still require explicit user approval.
OVERSEER STATUS
──────────────
NEXT ACTION
  review PR #42 before merging

RECENT NOTES
  [2026-05-14T10:00:00.000Z] patch applied, tests green
  [2026-05-14T09:45:00.000Z] blocked on schema migration review
```

### `overseer recent`

Prints a compact read-only summary of current local overseer context for fast terminal recovery:

- project identity (one-line, from local `project_brief.md` when available)
- current state anchor (from local current-state anchor when available, else latest git commit context)
- active branch/task
- next action
- current mode posture (serial default)
- runtime posture (switching inactive; `RELAYOS_RUNTIME_HOME` inspection-only)

Missing optional local files are shown as `not available` instead of failing.

`--json` prints stable machine-readable output with top-level fields:

- `project`
- `currentState`
- `activeBranch`
- `nextAction`
- `mode`
- `runtime`
- `warnings` (always an array)

Missing optional values degrade to `null` or clear unavailable values instead of crashing.

Compact example:

```json
{
  "project": "RelayOS is a local-first safety, audit, and handoff layer for AI-assisted development.",
  "currentState": {
    "anchor": "32ee222",
    "raw": "# Current State\n..."
  },
  "activeBranch": "runtime activation dry-run safety gate — shipped 32ee222",
  "nextAction": "Prepare the next safe Overseer control-plane slice...",
  "mode": {
    "current": "serial",
    "default": "serial",
    "writeTasks": "serial"
  },
  "runtime": {
    "relayosRuntimeHomeSet": false,
    "relayosRuntimeHome": null,
    "runtimeWorkspaceSwitchingActive": false,
    "currentRelayosResolution": "cwd",
    "posture": "switching inactive; RELAYOS_RUNTIME_HOME not set (inspect-only)"
  },
  "warnings": []
}
```

### `overseer context-pack`

Read-only curated continuity snapshot for non-MCP CLI workflows.

- `relayos overseer context-pack` prints a compact summary:
  project/current/next status, recent notes, recent decisions, boundaries, model policy,
  recommended prompt, and evidence links.
- `relayos overseer context-pack --json` returns the same context-pack
  payload shape used by `read_overseer_context_pack`.
- `--limit <1-20>` bounds `recent_notes` and `recent_decisions` (default `8`, max `20`).
- Missing local files are reported in `missing`; command remains read-only.
- No raw full chat transcript is returned.

### `overseer run-preflight`

Read-only future-run readiness check for scoped Rookie/handoff workflows.

- `relayos overseer run-preflight` prints a compact readiness summary.
- `relayos overseer run-preflight --json` prints deterministic machine-readable preflight output.
- This command is preflight only: it does not create a run, start agents, activate runtime, or mutate local state.
- Runner/queue/runtime execution are not active in current Core.

### `overseer summary`

Deterministic read-only session/migration summary assembled from existing local curated state.

- `relayos overseer summary` prints a compact human-readable summary with:
  context, current state, next action, recent decisions, recent notes, run-preflight snapshot, and a recommended next safe action prompt.
- `relayos overseer summary --json` returns stable machine-readable summary output.
- `--limit <1-20>` bounds `recent_notes` and `recent_decisions` (default `8`, max `20`).
- No model summarization is used.
- Command is read-only and does not create `.relayos/overseer/`.

### `overseer doctor`

Read-only local readiness diagnostic for overseer onboarding/migration sessions.

- `relayos overseer doctor` prints a compact checklist covering version visibility, cwd/workspace, local context completeness, recent notes/decisions, context-pack/summary/run-preflight readiness, tracked `.relayos/overseer` files, and possible stale `dist/cli.js` build.
- `relayos overseer doctor --json` returns stable machine-readable output with:
  `ok`, `tool`, `workspace_path`, `version`, `context_complete`, `missing`,
  `recent_notes_count`, `recent_decisions_count`, `run_preflight_ready`,
  `tracked_local_state_files`, `stale_build_possible`, `checks`,
  `recommended_next_action`, and `notes`.
- Command is diagnostics-only and does not create, modify, or delete `.relayos/overseer/` files.

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

Prints a concise startup brief for a fresh AI worker or human operator. Reads all context files from `.relayos/overseer/` and formats them into a single output block with the current next action, latest git commit, and a local data safety reminder.

```
$ relayos overseer brief
RELAYOS OVERSEER BRIEF  2026-05-14T10:00:00.000Z
────────────────────────────────────────────────

PROJECT
────────────────────────────────────────────────
RelayOS is a local-first control layer for AI-assisted development.
...

CURRENT STATE
────────────────────────────────────────────────
As of 2026-05-14: all Core/Solo features are shipped.

RELEASE POLICY
────────────────────────────────────────────────
...

FORBIDDEN ACTIONS
────────────────────────────────────────────────
...

PRODUCT DIRECTION
────────────────────────────────────────────────
...

NEXT ACTION
────────────────────────────────────────────────
  ship the patch

LATEST COMMIT
────────────────────────────────────────────────
  dc80449 @ main

LOCAL DATA SAFETY
────────────────────────────────────────────────
  Do not commit .relayos/overseer/ files, checkpoints, audit logs,
  handoff envelopes, transcripts, or private scratch to git.
  Handoff storage defaults to ~/.claude/handoff/ (outside repo).
  .relayos/overseer/ is gitignored in the project repo.
```

Context files that do not exist are shown as `(missing — file not found in .relayos/overseer/)`. Exits 0 even when all files are absent. Takes no arguments — exits 1 with usage if any are given.

`--json` prints the same core brief data as stable machine-readable JSON.

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

### `overseer init-context`

Creates missing context stub files under `.relayos/overseer/`. Skips any file that already exists — safe to run multiple times.

Files created (if absent):

```
.relayos/overseer/
├── project_brief.md
├── current.md
├── release_policy.md
├── forbidden_actions.md
├── product_direction.md
├── branches/active/brief.md
├── branches/active/progress.md
├── planned/enterprise_server.md
└── planned/web_panel.md
```

```
$ relayos overseer init-context
created: .relayos/overseer/project_brief.md
created: .relayos/overseer/current.md
...
```

If all files exist: `overseer context already complete — no files created`. Exits 0.

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

## Storage

| Path | Purpose |
|---|---|
| `.relayos/overseer/timeline.jsonl` | Append-only notes log. Each line is `{"ts":"<ISO>","text":"<text>"}`. |
| `.relayos/overseer/next_action.md` | Current next action (plain text, overwritten on each `next` call). |
| `.relayos/overseer/project_brief.md` | Project purpose and direction (human-edited). |
| `.relayos/overseer/current.md` | Latest commit anchor, test baseline, completed features. |
| `.relayos/overseer/release_policy.md` | Release rules (tag, publish, etc.). |
| `.relayos/overseer/forbidden_actions.md` | Actions that must not be taken without explicit instruction. |
| `.relayos/overseer/product_direction.md` | Guiding principles and roadmap status. |
| `.relayos/overseer/branches/active/brief.md` | Active branch/task name (overwritten on each `branch` call). |
| `.relayos/overseer/branches/active/progress.md` | Timestamped progress log for the active branch (append-only). |
| `.relayos/overseer/planned/enterprise_server.md` | Stub for planned enterprise server feature. |
| `.relayos/overseer/planned/web_panel.md` | Stub for planned web panel feature. |

All paths are under `.relayos/overseer/` in the project root. This directory is gitignored — runtime state never gets committed accidentally.

## Gitignore

`.relayos/overseer/` is in the repo's top-level `.gitignore`. Verify with:

```
git check-ignore -v .relayos/overseer/timeline.jsonl
```

## Exit codes

| Code | Condition |
|---|---|
| `0` | Success. |
| `1` | Missing required argument or unknown subcommand. |

## Source repo vs. runtime workspace

`.relayos/overseer/` inside the RelayOS source repo (`/Users/randy/GID`) is for development-time coordination: notes and state generated while working on RelayOS itself. It is gitignored and must not accumulate production runtime state from other projects.

When running RelayOS as a tool against a different project, operate from that project's directory. RelayOS resolves `.relayos/` relative to the current working directory, so coordination state stays in the target project, not in the RelayOS source tree.

Production runtime state — coordination notes, sub-run outputs, generated reports, operational logs for non-RelayOS projects — belongs outside the source repo entirely. See [docs/OVERSEER_WORKFLOW.md](OVERSEER_WORKFLOW.md) § "Source repo vs. runtime workspace" for the full treatment, and [docs/OVERSEER_RUNTIME_PLAN.md](OVERSEER_RUNTIME_PLAN.md) for the staged migration plan toward a separate production runtime workspace. `relayos overseer activate-runtime --dry-run` is implemented as a read-only safety check; real activation/switching remains future work.

## Non-goals

- No cloud sync and no cloud/server-side MCP surface.
- No background runner, daemon, or autonomous runtime.
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
