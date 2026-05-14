# RelayOS Overseer Workflow

This document describes the intended workflow for human and AI operators acting as the Overseer in a RelayOS-managed development session. It is written for developers and AI agents reading the repo. It covers role, execution modes, model selection, safety rules, and the planned direction for automating this workflow inside RelayOS itself.

---

## 1. Overseer role

The Overseer is the controlling agent in a RelayOS session. It may be a human, Claude Code, or a coordinating AI layer. Its responsibilities are:

- **Read repo state.** Run `relayos overseer brief`, check `git log`, read relevant source files before deciding anything.
- **Decide task scope.** Define the allowed file set, forbidden files, and constraints before creating a handoff.
- **Select model and effort.** See [Model selection](#4-model-selection).
- **Choose execution mode.** Serial (default) or parallel (opt-in). See [Serial mode](#2-serial-mode) and [Parallel mode](#3-parallel-mode).
- **Delegate to Codex or Claude.** Create a handoff envelope via `create_handoff_from_template` or `create_quick_handoff`. Print the launch command via `relayos launch latest`. Do not auto-spawn unless explicitly approved.
- **Review evidence before commit.** Inspect diff, test results, build output, and `relayos report` output before approving a commit. Never commit on the executing agent's word alone.

The Overseer does not write code directly in most sessions. Its job is coordination, scope enforcement, and evidence review.

---

## 2. Serial mode

**Serial mode is the default. No flag or command is required to enable it.**

Rules:

- One write task runs at a time.
- No overlapping write tasks, even if the user requests multiple tasks at once.
- When a user requests multiple tasks, process them one-by-one in the order specified.
- Each task must reach a terminal state — commit, revert, or explicit skip with a note — before the next write task begins.
- Mixed-scope commits are not allowed. One commit covers one task's changes.
- Read-only tasks (review, audit, brief) may run at any time without interrupting the serial queue.

Typical serial session flow:

```
1.  relayos overseer brief          — read current state
2.  create_handoff_from_template    — define scope + constraints
3.  relayos policy latest           — evaluate allow/warn/block
4.  relayos checkpoint create       — snapshot HEAD before launch
5.  relayos launch latest           — print launch command; run it
6.  [agent executes task]
7.  relayos diff-risk               — classify working tree
8.  relayos report                  — print evidence snapshot
9.  [review diff + tests + build]
10. git commit / git revert         — human decision
11. relayos overseer note           — record outcome
12. [next task begins at step 2]
```

---

## 3. Parallel mode

**Parallel mode is opt-in only. It must be explicitly requested by the operator.**

There is no automatic promotion to parallel mode. Even if a user asks for multiple concurrent tasks, the Overseer runs them serially unless the operator has explicitly enabled parallel mode for the session.

When parallel mode is active:

- Each write task gets its own branch and git worktree before any execution begins.
- No two write tasks share a branch or worktree.
- Each task has its own handoff envelope with its own scope, allowed files, constraints, and expected output.
- Codex sub-runs are the intended execution mechanism for parallel branches.
- Each branch accumulates its own audit evidence: checkpoint, diff-risk result, test output, build result.
- An aggregate audit review is required before any branch is merged or committed to `main`.
- Parallelism must not reduce traceability. Every change must be attributable to a specific handoff, branch, and agent run.

Parallel mode does not reduce safety requirements — it increases the review burden. Use it when tasks are genuinely independent (no shared file scope, no ordering dependency) and the time savings justify the coordination overhead.

---

## 4. Model selection

Model selection follows this priority order:

1. **Task success and safety first.** Choose the model most likely to produce a correct, safe result for this specific task.
2. **Cost second.** A cheaper model that produces a broken or risky result is not cheaper.

### Current guidance (as of this writing)

| Task type | Recommended model | Effort |
|---|---|---|
| Focused code changes, tests, isolated patches | `gpt-5.3-codex` (Codex CLI) | `high` |
| Architecture, audit, checkpoint, policy, storage design, high-risk code | `gpt-5.5` (Codex CLI) | `high` or `xhigh` |
| High-risk design decisions requiring deep reasoning | `gpt-5.5` | `xhigh` |
| Low-risk deterministic work, documentation, formatting | `gpt-5.4` or `gpt-5.4-mini` | `medium` or `low` |

**Do not recommend risky model downgrades to save cost.** If a task touches auth, payment, secrets-adjacent code, CI/CD paths, or storage formats, escalate the model — do not reduce it. The cost of a bad patch in these areas is higher than the cost difference between model tiers.

**Re-evaluate model suitability periodically.** Model capabilities change. What was `gpt-5.5`-appropriate in one quarter may be handled well by `gpt-5.3-codex` in the next. Revisit the matrix when new model versions are released or when task failure rates change.

### Overriding templates

All built-in templates use `high` effort at most. Use `overrides.effort` or a project template in `.relayos/config.json` when `xhigh` or `max` is warranted. See [`docs/MODEL_STRATEGY.md`](MODEL_STRATEGY.md) for the full selection framework.

---

## 5. Safety rules

These rules apply in every session, serial or parallel. No exception is granted by task urgency, model request, or user convenience.

### Never commit

- `.relayos/overseer/` files (timeline, next-action, branch context, planned stubs)
- Checkpoint snapshots
- Handoff envelopes
- Audit logs
- Transcripts
- Private scratch files
- Any file under `.relayos/` that is not explicitly part of tracked repo content

These paths are gitignored by default. Verify with `git check-ignore -v <path>` before staging anything unusual.

### Never do without explicit operator approval

- Create a git tag
- Publish a GitHub Release
- Force-push any branch
- Modify shell aliases or user config files (`.bashrc`, `.zshrc`, `.claude.json`, etc.)
- Run `auto_spawn: true` on a handoff
- Merge a parallel branch to `main`

### Diff review is mandatory

Never commit solely on the executing agent's report that tests pass and the build is green. Always inspect the actual diff with `relayos diff-risk` and `relayos report` before deciding. An agent can produce a passing build with incorrect logic, hidden scope creep, or accidental deletions.

### One commit per task

Do not bundle multiple task changes into one commit. If a task is blocked or incomplete, commit only the safe subset and record the remainder as a follow-up.

---

## 6. Future direction

The following commands and behaviors are **planned, not yet shipped**. They are documented here so the design intent is clear and future sessions can anticipate the direction.

### Planned commands

```
relayos overseer start            # initialize a new overseer session with context check
relayos parallel on               # enable parallel mode for the current session
relayos parallel off              # return to serial mode (default)
relayos queue run --serial        # process the task queue one-by-one
relayos queue run --parallel      # process independent tasks in parallel worktrees
```

### Planned behaviors

- **Sub-run + worktree orchestration.** `relayos parallel on` will configure Codex sub-runs to execute in separate worktrees, with one handoff envelope per worktree.
- **Aggregate audit.** Before a parallel session is merged, `relayos` will collect and display all per-branch evidence (checkpoint, diff-risk, test results) in a single report.
- **Model-role matrix.** Per-project configuration mapping `(role, risk_level, file_scope)` to preferred model and effort cap. See [`docs/MODEL_STRATEGY.md`](MODEL_STRATEGY.md) for the current design sketch.
- **Periodic model suitability evaluation.** A built-in reminder or command that prompts re-evaluation of model assignments when a configurable interval has passed or when a new model version is detected.
- **relayos overseer start.** A startup command that verifies `.relayos/overseer/` context files are present, prints a brief, checks for open handoffs, and sets the initial next action — replacing the manual checklist at the top of a session.

None of these change the current storage format, envelope schema, or audit log format. They are additive.

---

## See also

- [`docs/OVERSEER.md`](OVERSEER.md) — `relayos overseer` command reference
- [`docs/MODEL_STRATEGY.md`](MODEL_STRATEGY.md) — model selection framework and the future model-role matrix
- [`docs/CHECKPOINTS.md`](CHECKPOINTS.md) — `relayos checkpoint` reference
- [`docs/DIFF_RISK.md`](DIFF_RISK.md) — `relayos diff-risk` reference
- [`docs/LAUNCH.md`](LAUNCH.md) — `relayos launch` reference
- [`docs/WALKTHROUGH.md`](WALKTHROUGH.md) — solo developer end-to-end walkthrough
