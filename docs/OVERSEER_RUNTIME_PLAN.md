# RelayOS Overseer Runtime Migration Plan

This document describes the staged migration plan for moving Overseer operation from development-local state toward a separate production/runtime workspace. Several read-only preparation steps are already implemented (environment inspection, JSON status/mode/start/brief output, and `activate-runtime --dry-run`). Runtime workspace switching and real activation remain future direction. The plan is written so that future Codex/Claude sessions can follow the stages without revisiting the design rationale.

---

## 1. Current state (Stage 0)

The RelayOS source repo at `/Users/randy/GID` is the development worktree. It is not a production runtime base.

What is true today:

- `.relayos/overseer/` is gitignored and holds dev-time coordination state for RelayOS development work only.
- Handoff envelopes, checkpoints, and audit logs are written to `~/.claude/handoff/` — outside any repo — by default.
- All `.relayos/` paths resolve relative to the current working directory. Runtime home is not active for path resolution.
- `RELAYOS_RUNTIME_HOME` is read for inspection/warning output only; it does not activate runtime switching.
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

Until runtime switching is implemented, the recommended approach is to run RelayOS commands from the target project's directory. `.relayos/` resolves relative to CWD, so coordination state goes into the target project, not the RelayOS source tree.

---

## 4. Migration stages

Each stage is a discrete, safe increment. No stage is skipped. No stage automatically migrates old state.

### Stage 0 — current dev-local state ✓ (now)

- Source repo is clean for development.
- `.relayos/overseer/` holds only RelayOS dev coordination state.
- All commands are read-only or control-plane.
- No active runtime workspace switching in code.

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

### Stage 3.5 — read-only activation safety dry-run (implemented baseline)

- `relayos overseer activate-runtime --dry-run --path <runtime-path> [--source <source-repo-path>] [--json]` ships as a read-only safety check.
- Requires `--dry-run` and `--path`; does not create directories or write files.
- Returns `allow` / `warn` / `block` with machine-readable JSON and human-readable safety output.
- Runtime switching remains inactive.

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

## 8. Dry-run command design (implemented baseline + future extensions)

The read-only dry-run command now exists in baseline form. This section keeps the broader design and future extensions that are not yet implemented.

### Purpose

Before any real runtime workspace activation happens, the operator needs a way to inspect what activation would do, catch safety problems, and get a clear allow/warn/block verdict — all without touching the file system. This is the dry-run command.

### Command

```
relayos overseer activate-runtime --dry-run [--path <runtime-path>] [--source <source-repo-path>]
```

- `--dry-run` is always required for the read-only inspection mode. The command must not accept activation without it until Stage 5 is fully implemented and tested.
- `--path` specifies the proposed runtime workspace path. It is required in the current implementation.
- `--source` specifies the source repo to check against. Defaults to the current working directory.
- `--json` outputs the same report in machine-readable JSON (same shape as other `--json` commands).

Alternative name under consideration: `relayos overseer runtime-check`.

### Inputs

| Input | Source | Default |
|---|---|---|
| Proposed runtime workspace path | `--path` | Required |
| Source repo path | `--source` | Current working directory |
| `RELAYOS_RUNTIME_HOME` env var | Process environment | Unset |

The command reads these inputs and performs all checks below without writing to any path.

### Read-only checks

Each check is performed read-only against resolved paths and local git state.

1. **Current working directory** — report the resolved CWD; confirm it matches the expected source repo.
2. **Proposed runtime path existence** — does the path exist? If not, note it would be created on activation.
3. **Inside-source-repo check** — is the proposed runtime path under the source repo root? This is a hard block condition (see Safety decisions).
4. **Git-tracked check** — when the proposed runtime path is under the source repo, check whether it appears tracked by git. Git-tracked runtime paths are blocked.
5. **Source-repo overseer state** — report whether `.relayos/overseer/` exists in the source repo.
6. **`RELAYOS_RUNTIME_HOME` consistency** — if the env var is set, confirm it matches `--path`. If they differ, warn.

### Safety decisions

| Condition | Decision | Reason |
|---|---|---|
| Runtime path is inside source repo root | **block** | Would contaminate source tree with runtime state |
| Runtime path is inside any git-tracked tree and not gitignored | **block** | Runtime files would be stageable; accidental commits likely |
| Runtime path does not exist | **warn** | Would be created on activation — operator must confirm intent |
| `RELAYOS_RUNTIME_HOME` set but differs from `--path` | **warn** | Ambiguous; env var and flag should agree |
| All checks pass | **allow** | Safe to proceed to activation when implemented |

No state is moved, deleted, or created in dry-run regardless of decision.

### Output format

Human-readable (default) includes:

- heading: `OVERSEER RUNTIME ACTIVATION DRY-RUN`
- source repo and proposed runtime path
- `RELAYOS_RUNTIME_HOME` status
- explicit checks (`exists`, `inside source repo`, `appears git-tracked`, source overseer state, env match)
- `WARNINGS` and `BLOCKS` sections
- final `decision: ALLOW|WARN|BLOCK`
- explicit no-write / no-switching statement

Machine-readable JSON shape (`--json`):

```json
{
  "decision": "warn",
  "sourceRepo": "/Users/randy/GID",
  "runtimePath": "/tmp/relayos-runtime",
  "runtimePathExists": false,
  "runtimePathInsideSourceRepo": false,
  "runtimePathGitTracked": false,
  "sourceOverseerStateExists": true,
  "relayosRuntimeHomeSet": false,
  "relayosRuntimeHome": null,
  "relayosRuntimeHomeMatchesPath": false,
  "runtimeWorkspaceSwitchingActive": false,
  "wroteFiles": false,
  "createdDirectories": false,
  "warnings": ["Proposed runtime workspace path does not exist."],
  "blocks": [],
  "notes": [
    "Dry-run only: no files were written, moved, or deleted.",
    "Runtime workspace switching is not active.",
    "Current `.relayos/` resolution behavior is unchanged."
  ]
}
```

The JSON shape above reflects current implementation. Additive fields are allowed; breaking field changes require explicit review.

### Non-goals

- No actual activation. `--dry-run` is read-only; no state changes.
- No file writes. No directory creation. No path mutation of any kind.
- No migration of `.relayos/overseer/` content. Migration is Stage 4's concern.
- No background sub-runs. No parallel mode enablement.
- No modification of `RELAYOS_RUNTIME_HOME` or any environment variable.
- No changes to envelope, checkpoint, or audit log formats.

### Future implementation guardrails

Current guardrails and future work:

- **First implementation must be strictly read-only.** No write path may be added until the dry-run output has been stable for at least one released version.
- **Inside-source-repo block must have tests.** Cover: path equal to source root, path is a subdirectory of source root, path is a sibling directory (allowed).
- **Unset/set `RELAYOS_RUNTIME_HOME` must both be tested.** Cover: env unset + `--path` provided, env set + `--path` matches, env set + `--path` differs (warn).
- **Git-tracked check must have tests.** Cover: path inside tracked repo (block), path outside tracked source tree (allow/warn depending on other checks).
- **`--json` output must be tested.** The JSON shape is a contract; field renames require a semver bump.
- **No runtime switching until dry-run output is stable.** Stage 5 (actual activation) must not begin until the dry-run command has shipped, has test coverage, and has been reviewed in at least one real session.
- **The `decision` field drives automation.** Future CI or agent workflows that want to automate activation must gate on `decision === "allow"` from `--json` output. Warn and block must both halt automation.

---

## See also

- [`docs/OVERSEER_WORKFLOW.md`](OVERSEER_WORKFLOW.md) — Overseer role, serial/parallel mode, safety rules, source/runtime separation
- [`docs/OVERSEER.md`](OVERSEER.md) — `relayos overseer` command reference, including `env`
- [`docs/CHECKPOINTS.md`](CHECKPOINTS.md) — `relayos checkpoint` reference
- [`docs/MODEL_STRATEGY.md`](MODEL_STRATEGY.md) — model selection framework
