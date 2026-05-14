# RelayOS: solo developer walkthrough

A realistic session showing how RelayOS fits into an AI-assisted coding
workflow — from recovering context at the start to taking an evidence
snapshot at the end. All storage is local; nothing runs automatically.

**Prereqs** (one-time):

- `npm install && npm run build && npm link` in this repo.
- RelayOS MCP server registered in Claude Code and Codex CLI (see
  [README → Install](../README.md#install)).

---

## 1. Recover context at session start

Before writing a single line of code, run:

```bash
relayos overseer brief
```

This reads the local `.relayos/overseer/` workspace and prints a
structured brief: the project description, current state (latest commit
anchor, test baseline, completed features), release policy, forbidden
actions, product direction, and the current next action.

The brief exists for exactly this moment — when you're starting cold
after a context reset or switching from a different task. A 10-second
read instead of scrolling through a previous chat.

If the workspace hasn't been initialized yet:

```bash
relayos overseer init-context   # scaffolds stub files; skips existing ones
```

Then fill in the stubs and run `overseer brief` again.

---

## 2. Create or receive a handoff

**From Claude (Rookie Mode):** Stay in your Claude Code session and
describe the task in plain language. Claude calls `create_quick_handoff`
and the envelope is recorded to disk. You get a handoff id and the
launch command back in chat.

**Manually:** For precise control, use a template:

```bash
# In a Claude Code session (MCP tool call):
create_handoff_from_template {
  "template": "codex-patch",
  "task": "Refactor src/api/util/format.ts to use template literals.",
  "overrides": { "allowed_files": ["src/api/util/**/*.ts"] }
}
```

Either way, the validated envelope lives at
`~/.claude/handoff/envelopes/h_….json`. The audit log at
`~/.claude/handoff/audit.jsonl` records `created` and `validated`
events automatically.

---

## 3. Evaluate policy before launching

Before running Codex, check the envelope against the policy gate:

```bash
relayos policy latest
```

You'll see `DECISION: ALLOW`, `WARN`, or `BLOCK` plus a one-line reason
for each finding. A `BLOCK` means the envelope triggered a hard rule
(secret file scope, force-push command, etc.) — fix the envelope before
proceeding.

```bash
relayos launch latest           # print the codex exec command
```

`relayos launch` is print-only. It never spawns anything. Copy the
printed command and run it yourself, or inline it:

```bash
$(relayos launch latest)        # run Codex with the recorded parameters
```

---

## 4. Snapshot the working tree before risky work

Before handing off to Codex (or right after, before reviewing the
diff), take a checkpoint:

```bash
relayos checkpoint create --message "pre-codex refactor"
```

This captures four artifacts to `~/.claude/handoff/checkpoints/`:

- `c_….json` — metadata: id, timestamp, HEAD, branch, dirty flag
- `c_….status` — `git status --short` output
- `c_….diff` — `git diff HEAD` output (up to 32 MB)
- `c_….untracked` — untracked file paths

The checkpoint is read-only against your working tree: no `git add`,
no stash, no commit. It is a timestamped observation, not a mutation.

---

## 5. Classify diff risk before committing

After Codex has applied its changes, run:

```bash
relayos diff-risk
```

This scans `git diff HEAD` plus untracked files and classifies the
working tree as `ALLOW`, `WARN`, or `BLOCK`. It checks for:

- Secret / credential paths (`.env*`, `*.key`, `id_rsa`, …) → block
- CI / deploy paths (`.github/workflows/`, `Dockerfile`, …) → warn
- Dependency manifests (`package.json`, `Cargo.toml`, …) → warn
- Auth / security / payment / database paths → warn
- Large deletions (≥ 200 lines removed, or any file deleted) → warn
- Risky commands in added diff lines (`rm -rf`, `git push --force`,
  `curl … | sh`, …) → warn

`diff-risk` is read-only. It does not modify your tree.

Review any `WARN` or `BLOCK` findings before running `git commit`.

---

## 6. Take an evidence snapshot

Before or after committing, print a full evidence snapshot:

```bash
relayos report
```

The report prints four sections in one pass:

1. **Latest handoff** — id, task title, model, effort, execution mode
2. **Latest checkpoint** — id, HEAD, branch, dirty flag, diff size
3. **Diff-risk summary** — current working tree decision and findings
4. **Git status** — the same `git status --short` output

This is the record you keep when something goes wrong later and you
need to reconstruct "what was the state when Codex ran?"

---

## 7. Plan a rollback with checkpoint restore

If the Codex changes look wrong and you want to understand what a
rollback would involve, inspect the checkpoint you took:

```bash
relayos checkpoint restore latest --dry-run
```

Output:

```
CHECKPOINT RESTORE DRY-RUN
────────────────────────────────────────────
id:          c_01HR…
created_at:  2026-05-14T10:14:22Z
cwd:         /Users/you/your-repo
branch:      main
head:        dc80449

CAPTURED STATE
────────────────────────────────────────────
  status:    7 line(s)
  diff:      12,834 bytes — patch available
  untracked: 2 file(s) captured
  diff file: /Users/.../.claude/handoff/checkpoints/c_01HR….diff

WARNING: THIS IS A DRY-RUN — NO FILES HAVE BEEN MODIFIED
────────────────────────────────────────────
  --apply is not yet implemented; restore is plan-only.
  To inspect the captured diff:
    cat /Users/.../.claude/handoff/checkpoints/c_01HR….diff | less
```

This tells you exactly what was captured and where to find the diff
file. If you want to manually roll back, inspect the `.diff` and apply
it yourself with `git apply -R` or by reverting commits. `--apply` is
reserved for a future release; `--dry-run` is the only mode today.

---

## 8. Local coordination state is gitignored

The `.relayos/overseer/` directory holds your local coordination
workspace: notes timeline, next action, active branch, progress log,
and context files. It is listed in `.gitignore` — none of it is ever
committed accidentally.

Handoff envelopes, checkpoint artifacts, and the audit log all live
under `~/.claude/handoff/` by default — outside any project repo
entirely.

To record what you did and set the next action:

```bash
relayos overseer note "Codex refactor applied; diff-risk clean; committed"
relayos overseer next "review PR after CI"
relayos overseer branch "refactor-template-literals"
relayos overseer progress "patch applied, tests green"
```

Next time you start a session, `relayos overseer brief` surfaces all
of this in one read.

---

## Summary: the loop

```
overseer brief          → recover context
create handoff          → record the task
relayos policy latest   → check the envelope
relayos checkpoint create → snapshot state
$(relayos launch)       → run Codex
relayos diff-risk       → classify the changes
relayos report          → evidence snapshot
relayos checkpoint restore latest --dry-run → plan rollback if needed
overseer note / next    → record what happened
```

Each step is an explicit operator action. Nothing runs automatically.
Every event is appended to the local audit log. The entire loop is
reproducible from the artifacts on disk.

---

## See also

- [`docs/QUICK_DEMO.md`](./QUICK_DEMO.md) — 5-step Claude → RelayOS → Codex demo
- [`docs/ROOKIE_MODE.md`](./ROOKIE_MODE.md) — chat-only workflow and risk gate
- [`docs/CHECKPOINTS.md`](./CHECKPOINTS.md) — checkpoint capture and restore reference
- [`docs/DIFF_RISK.md`](./DIFF_RISK.md) — diff-risk rule set and exit codes
- [`docs/OVERSEER.md`](./OVERSEER.md) — overseer workspace reference
- [`docs/REFERENCES.md`](./REFERENCES.md) — RelayOS vs OpenSpec and Superpowers
- [`README.md`](../README.md) — install, MCP wiring, full tools table
