# relayos overseer

A gitignored local coordination workspace. Stores a running notes timeline and a "next action" pointer so Claude, Codex, and the human operator can recover current work state without relying on long chat context or terminal scrollback.

## Commands

```
relayos overseer status
relayos overseer note <text...>
relayos overseer next [text...]
relayos overseer brief
```

### `overseer status`

Prints the current next action and the five most recent notes. If no state exists yet, prints a setup prompt.

```
OVERSEER STATUS
──────────────
NEXT ACTION
  review PR #42 before merging

RECENT NOTES
  [2026-05-14T10:00:00.000Z] patch applied, tests green
  [2026-05-14T09:45:00.000Z] blocked on schema migration review
```

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

## Storage

| Path | Purpose |
|---|---|
| `.relayos/overseer/timeline.jsonl` | Append-only notes log. Each line is `{"ts":"<ISO>","text":"<text>"}`. |
| `.relayos/overseer/next_action.md` | Current next action (plain text, overwritten on each `next` call). |

Both paths are under `.relayos/overseer/` in the project root. This directory is gitignored — runtime state never gets committed accidentally.

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

## Non-goals

- No cloud sync, no MCP tool surface, no background runner.
- No structured query, search, or pagination of notes.
- No multi-project or cross-repo scope — storage is always project-local.
- No encryption or access control — treat as local scratch space.

## See also

- [`docs/CHECKPOINTS.md`](CHECKPOINTS.md) — captures full git state before risky handoffs.
- [`docs/DIFF_RISK.md`](DIFF_RISK.md) — classifies the working tree before `git commit`.
- [`docs/LAUNCH.md`](LAUNCH.md) — prints the `codex exec` command for the newest open handoff.
