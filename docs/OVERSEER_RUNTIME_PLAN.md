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

## See also

- [`docs/OVERSEER_WORKFLOW.md`](OVERSEER_WORKFLOW.md) — Overseer role, serial/parallel mode, safety rules, source/runtime separation
- [`docs/OVERSEER.md`](OVERSEER.md) — `relayos overseer` command reference, including `env`
- [`docs/CHECKPOINTS.md`](CHECKPOINTS.md) — `relayos checkpoint` reference
- [`docs/MODEL_STRATEGY.md`](MODEL_STRATEGY.md) — model selection framework
