# RelayOS Overseer Runtime Migration Plan

This document describes the staged migration plan for moving Overseer operation from development-local state toward a separate production/runtime workspace. Nothing in this plan is implemented yet beyond Stage 1. All runtime workspace switching is future direction. The plan is written so that future Codex/Claude sessions can follow the stages without revisiting the design rationale.

---

## 1. Current state (Stage 0)

The RelayOS source repo at `/Users/randy/GID` is the development worktree. It is not a production runtime base.

What is true today:

- `.relayos/overseer/` is gitignored and holds dev-time coordination state for RelayOS development work only.
- Handoff envelopes, checkpoints, and audit logs are written to `~/.claude/handoff/` — outside any repo — by default.
- All `.relayos/` paths resolve relative to the current working directory. There is no configurable runtime home.
- `RELAYOS_RUNTIME_HOME` is documented as future direction; it is not read or used by any current code.
- Current overseer commands are control-plane and read-only for orchestration: `start`, `mode`, `env`, `brief`, `status`, `next`, `note`, `progress`, `branch`, `init-context`.
- No write task generates runtime output files or sub-run outputs; those concepts are future direction.

The source repo must stay clean. No production operational state, generated reports, sub-run outputs, agent transcripts, or non-RelayOS project coordination notes should accumulate here.

---

## 2. Target: production/runtime workspace

The goal is a **separate runtime workspace directory** — outside `/Users/randy/GID` — where the Overseer operates against target projects. This directory:

- Stores operational coordination state for non-RelayOS projects.
- Holds handoff envelopes, checkpoints, and audit evidence created during target-project work.
- Accumulates sub-run outputs, agent transcripts, and generated reports.
- Contains scratch files, working notes, and operational logs.
- Is never committed to the RelayOS source repo unless content is explicitly promoted into public docs, tests, or examples.

The runtime workspace is not a second clone of the RelayOS source repo. It is an operational directory — closer in concept to a log directory or a per-project scratch space.

---

## 3. Suggested runtime locations

These are concrete examples; the exact path is operator choice.

| Option | Path | Notes |
|---|---|---|
| Named workspace | `~/RelayOS-Overseer/` | Clear, purpose-named, not inside any project |
| Generic runtime home | `~/relayos-runtime/` | Matches the future `RELAYOS_RUNTIME_HOME` naming |
| Project-collocated | `~/projects/myapp/.relayos-runtime/` | One runtime dir per target project, outside source repo |
| Future env var | `$RELAYOS_RUNTIME_HOME` | Will be the canonical path when implemented |

Until `RELAYOS_RUNTIME_HOME` is implemented, the recommended approach is to run RelayOS commands from the target project's directory. `.relayos/` resolves relative to CWD, so coordination state goes into the target project, not the RelayOS source tree.

---

## 4. Migration stages

Each stage is a discrete, safe increment. No stage is skipped. No stage automatically migrates old state.

### Stage 0 — current dev-local state ✓ (now)

- Source repo is clean for development.
- `.relayos/overseer/` holds only RelayOS dev coordination state.
- All commands are read-only or control-plane.
- No runtime workspace concept in code.

### Stage 1 — documented plan only ✓ (this document)

- The migration plan is written and linked from `OVERSEER.md` and `OVERSEER_WORKFLOW.md`.
- No code changes.
- Operators and future sessions know what is coming and why.

### Stage 2 — read-only env boundaries (baseline)

- `relayos overseer env` already ships and prints environment boundaries.
- Verify that it correctly reports: CWD and whether `RELAYOS_RUNTIME_HOME` is set.
- No write paths. No config files created.
- Acceptance: `relayos overseer env` output is correct and stable; covered by tests.

### Stage 3 — optional runtime home inspection refinement

- Enhance `relayos overseer env` messaging for `RELAYOS_RUNTIME_HOME` when set.
- Mark the value as inspection-only and explicitly state that runtime workspace switching is not active yet.
- Do not validate path existence and do not read runtime state from that path.
- **Still read-only.** No path is written to. No migration happens.
- `.relayos/config.json` may optionally include `runtimeHome` as a documented field — validated but not yet acted upon.
- Acceptance: `env` output reflects the env var clearly; no switching/write paths touched.

### Stage 4 — explicit migration command or guided copy

- `relayos overseer migrate-runtime` (name TBD): dry-run by default, shows what would move, requires `--confirm` to act.
- Copies `.relayos/overseer/` content from source repo to runtime workspace.
- Does **not** delete the source. Operator reviews and removes manually if desired.
- Dry-run output must be reviewed before `--confirm` is passed.
- No automatic invocation. No background migration.
- Acceptance: dry-run shows correct file list; `--confirm` copies without touching source; tests cover both paths.

### Stage 5 — production overseer start uses runtime workspace

- When `RELAYOS_RUNTIME_HOME` is set (env or config), `relayos overseer start` reads context from runtime workspace instead of source-relative `.relayos/overseer/`.
- Source-relative `.relayos/overseer/` continues to exist for dev-time use when `RELAYOS_RUNTIME_HOME` is not set.
- `overseer brief`, `status`, `note`, `next`, `progress` all respect the runtime home when set.
- No silent fallback. If `RELAYOS_RUNTIME_HOME` is set but does not exist, emit an error — do not silently fall back to the source path.
- Acceptance: full test coverage for both modes; `relayos overseer env` clearly shows which path is active.

### Stage 6 — parallel sub-run/worktree orchestration writes runtime evidence outside source repo

- When parallel mode is active and `RELAYOS_RUNTIME_HOME` is set, sub-run outputs, per-branch audit evidence, and generated reports go into the runtime workspace, not into branch worktrees under the source repo.
- Aggregate audit reads from the runtime workspace.
- Source repo worktrees contain only source changes — no operational output.
- Acceptance: parallel mode end-to-end test confirms runtime workspace receives evidence; source repo worktrees are clean.

---

## 5. Safety rules

These rules apply across all stages. No exception for urgency or convenience.

| Rule | Detail |
|---|---|
| No automatic migration | State is never moved without explicit operator action. |
| No automatic deletion | Old state is never removed without explicit operator confirmation. |
| No source repo writes for runtime logs | Operational output never writes into `/Users/randy/GID` or any source worktree. |
| No committing runtime workspace content | Runtime files stay in the runtime workspace. Promote explicitly to docs/tests if needed. |
| No storage/envelope/audit format changes | Format changes require a separate explicit design and migration doc. |
| Runtime switching is opt-in and visible | `relayos overseer env` must always show which path is active. |
| Dry-run before `--confirm` | Any migration command defaults to dry-run. |
| Error on missing runtime home | If `RELAYOS_RUNTIME_HOME` is set but absent, error — no silent fallback. |

---

## 6. Open questions

These are unresolved design questions that must be answered before Stage 3 or later stages are implemented. They are recorded here so future sessions do not re-litigate the basics.

**Runtime directory naming.** Should the path be `~/RelayOS-Overseer/`, `~/relayos-runtime/`, or something else? Does the name matter for discoverability?

**Per-project vs. global runtime workspace.** Should there be one runtime workspace per target project (e.g., `~/relayos-runtime/myapp/`) or a single global one (`~/relayos-runtime/`) with project-namespaced subdirectories? The per-project model is cleaner for isolation; the global model is simpler to configure.

**Source repo to runtime state mapping.** When `RELAYOS_RUNTIME_HOME` is set, how does RelayOS know which source repo's coordination state lives in which runtime subdirectory? By CWD? By a project key in config? By git remote URL hash?

**Secrets and private logs.** Sub-run outputs and agent transcripts may contain sensitive information (API keys in prompts, private file contents, proprietary code). The runtime workspace must not be treated as safe to share or commit. How should this be surfaced to operators?

**Exporting audit summaries.** The planned aggregate audit command needs to produce a shareable summary without leaking raw runtime state, scratch content, or private logs. The export format and redaction strategy are TBD.

---

## 7. Implementation guardrails for future Codex work

When a future session begins implementing any stage past Stage 2, these guardrails apply:

- **First implementation of any write path must be dry-run.** Implement `--dry-run` before `--confirm`. Tests must cover both.
- **Every write path must have tests.** No write path is merged without a test that exercises it and verifies the file system result.
- **No background sub-run orchestration before the runtime workspace boundary is implemented.** Parallel mode may not write sub-run evidence into source worktrees. Wait for Stage 5 before implementing parallel evidence collection.
- **Aggregate audit reads runtime evidence but does not commit raw runtime state.** The audit summary command may read from the runtime workspace; it must never write runtime content back into the source repo.
- **`relayos overseer env` must reflect the active path before any write command runs.** If `env` is wrong, the write commands will write to the wrong place. Fix `env` first.
- **No format changes to envelope, checkpoint, or audit log schemas without a separate migration doc.** Adding a `runtimeHome` field to `.relayos/config.json` is acceptable (additive); changing existing field semantics is not.
- **Stage gates are not optional.** Do not jump from Stage 1 to Stage 5. Each stage must be reviewed and committed before the next begins.

---

## 8. Dry-run command design (future, not implemented)

**This section is a design spec, not a description of current behavior.** Nothing described here is implemented. The command and all behaviors are future direction.

### Purpose

Before any real runtime workspace activation happens, the operator needs a way to inspect what activation would do, catch safety problems, and get a clear allow/warn/block verdict — all without touching the file system. This is the dry-run command.

### Command

```
relayos overseer activate-runtime --dry-run [--path <runtime-path>] [--source <source-repo-path>]
```

- `--dry-run` is always required for the read-only inspection mode. The command must not accept activation without it until Stage 5 is fully implemented and tested.
- `--path` specifies the proposed runtime workspace path. Defaults to `RELAYOS_RUNTIME_HOME` if set.
- `--source` specifies the source repo to check against. Defaults to the current working directory.
- `--json` outputs the same report in machine-readable JSON (same shape as other `--json` commands).

Alternative name under consideration: `relayos overseer runtime-check`. Final name TBD before implementation.

### Inputs

| Input | Source | Default |
|---|---|---|
| Proposed runtime workspace path | `--path` or `RELAYOS_RUNTIME_HOME` | Required if env var not set |
| Source repo path | `--source` | Current working directory |
| `RELAYOS_RUNTIME_HOME` env var | Process environment | Unset |

The command reads these inputs and performs all checks below without writing to any path.

### Read-only checks

Each check is performed in order. Later checks may be skipped if an earlier one produces a block.

1. **Current working directory** — report the resolved CWD; confirm it matches the expected source repo.
2. **Proposed runtime path existence** — does the path exist? If not, note it would be created on activation.
3. **Inside-source-repo check** — is the proposed runtime path under the source repo root? This is a hard block condition (see Safety decisions).
4. **Git-tracked check** — is the proposed runtime path inside any git-tracked tree? Check whether `git check-ignore -v <path>` exits non-zero (i.e., not gitignored). A non-gitignored path within a tracked repo is a block or strong warn.
5. **Expected subdirectory presence** — if the path exists, does it contain expected runtime subdirs (e.g., `.relayos/overseer/`)? Missing subdirs produce an informational note; unexpected top-level contents produce a warn.
6. **Source-repo overseer state** — does `.relayos/overseer/` currently exist in the source repo? Report its size and last-modified time so the operator knows what would need to be migrated.
7. **`RELAYOS_RUNTIME_HOME` consistency** — if the env var is set, confirm it matches `--path`. If they differ, warn.

### Safety decisions

| Condition | Decision | Reason |
|---|---|---|
| Runtime path is inside source repo root | **block** | Would contaminate source tree with runtime state |
| Runtime path is inside any git-tracked tree and not gitignored | **block** | Runtime files would be stageable; accidental commits likely |
| Runtime path does not exist | **warn** | Would be created on activation — operator must confirm intent |
| Runtime path exists but contains unexpected top-level files | **warn** | May indicate wrong directory or prior state collision |
| Runtime path is gitignored within a tracked repo (but outside source repo) | **warn** | Acceptable, but confirm intent; gitignore protects it |
| `RELAYOS_RUNTIME_HOME` set but differs from `--path` | **warn** | Ambiguous; env var and flag should agree |
| All checks pass | **allow** | Safe to proceed to activation when implemented |

No state is moved, deleted, or created in dry-run regardless of decision.

### Output format

Human-readable (default):

```
RELAYOS OVERSEER ACTIVATE-RUNTIME  (dry-run)
────────────────────────────────────────────

SOURCE REPO
  /Users/randy/GID
  .relayos/overseer/ exists: yes (last modified 2026-05-14)

PROPOSED RUNTIME PATH
  /Users/randy/relayos-runtime
  exists: no (would be created on activation)
  inside source repo: no
  git-tracked: no

RUNTIME HOME ENV
  RELAYOS_RUNTIME_HOME: not set

CHECKS
  [OK]   Source repo identified
  [OK]   Runtime path is outside source repo
  [OK]   Runtime path is not git-tracked
  [WARN] Runtime path does not exist — would be created on activation
  [OK]   No unexpected files at runtime path

DECISION: warn

  One or more warnings require operator acknowledgment before activation.
  Review the warnings above and re-run with --confirm when ready (future flag).
  No files were written, moved, or deleted.
```

Machine-readable JSON shape (`--json`):

```json
{
  "command": "activate-runtime",
  "dry_run": true,
  "source_repo": "/Users/randy/GID",
  "source_overseer_exists": true,
  "source_overseer_last_modified": "2026-05-14T10:00:00.000Z",
  "proposed_runtime_path": "/Users/randy/relayos-runtime",
  "runtime_path_exists": false,
  "runtime_path_inside_source_repo": false,
  "runtime_path_git_tracked": false,
  "runtime_path_gitignored": false,
  "relayos_runtime_home_env": null,
  "env_path_matches_flag": true,
  "checks": [
    { "id": "source_repo",       "status": "ok",   "detail": "Source repo identified" },
    { "id": "outside_source",    "status": "ok",   "detail": "Runtime path is outside source repo" },
    { "id": "not_git_tracked",   "status": "ok",   "detail": "Runtime path is not git-tracked" },
    { "id": "path_exists",       "status": "warn", "detail": "Runtime path does not exist — would be created on activation" },
    { "id": "no_unexpected",     "status": "ok",   "detail": "No unexpected files at runtime path" }
  ],
  "decision": "warn"
}
```

The JSON shape is a design target. Field names and structure may change before implementation, but the top-level fields `dry_run`, `decision`, and `checks` are stable anchors.

### Non-goals

- No actual activation. `--dry-run` is read-only; no state changes.
- No file writes. No directory creation. No path mutation of any kind.
- No migration of `.relayos/overseer/` content. Migration is Stage 4's concern.
- No background sub-runs. No parallel mode enablement.
- No modification of `RELAYOS_RUNTIME_HOME` or any environment variable.
- No changes to envelope, checkpoint, or audit log formats.

### Future implementation guardrails

When this command is implemented:

- **First implementation must be strictly read-only.** No write path may be added until the dry-run output has been stable for at least one released version.
- **Inside-source-repo block must have tests.** Cover: path equal to source root, path is a subdirectory of source root, path is a sibling directory (allowed).
- **Unset/set `RELAYOS_RUNTIME_HOME` must both be tested.** Cover: env unset + `--path` provided, env set + no `--path`, env set + `--path` matches, env set + `--path` differs (warn).
- **Git-tracked check must have tests.** Cover: path inside tracked repo not gitignored (block), path inside tracked repo and gitignored (warn), path outside any repo (ok).
- **`--json` output must be tested.** The JSON shape is a contract; field renames require a semver bump.
- **No runtime switching until dry-run output is stable.** Stage 5 (actual activation) must not begin until the dry-run command has shipped, has test coverage, and has been reviewed in at least one real session.
- **The `decision` field drives automation.** Future CI or agent workflows that want to automate activation must gate on `decision === "allow"` from `--json` output. Warn and block must both halt automation.

---

## See also

- [`docs/OVERSEER_WORKFLOW.md`](OVERSEER_WORKFLOW.md) — Overseer role, serial/parallel mode, safety rules, source/runtime separation
- [`docs/OVERSEER.md`](OVERSEER.md) — `relayos overseer` command reference, including `env`
- [`docs/CHECKPOINTS.md`](CHECKPOINTS.md) — `relayos checkpoint` reference
- [`docs/MODEL_STRATEGY.md`](MODEL_STRATEGY.md) — model selection framework
