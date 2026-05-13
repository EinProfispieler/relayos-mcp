# `relayos launch`

A one-line CLI helper that prints the launch command for a recorded
handoff. It does **not** run the target agent — it only prints the
exact command you (or the source agent) would run.

```bash
relayos launch                  # latest open handoff
relayos launch latest           # explicit
relayos launch 1                # most recent open handoff (1-based)
relayos launch h_01HQ…          # exact handoff id (any status)
```

`relayos launch` reads from `$HANDOFF_DIR` (default `~/.claude/handoff/`)
and prints a single line on stdout. Pipe it, copy it, eyeball it — the
choice is yours.

---

## When to use it

After Claude (or any source agent) files a handoff, you typically have
two options to actually run the target:

1. Let the source agent print the `launch_command` in its response and
   copy-paste it.
2. Run `relayos launch` from any terminal and get the same string.

Option 2 is helpful when the source-agent chat is far up the buffer, when
you want to script around the command, or when you want to verify the
exact `model` / `effort` / `sandbox` flags before running the target.

`relayos launch` is **print-only by default**. It never spawns the
target itself. Spawning is a separate, explicit step — that keeps the
audit trail clean and lets you inspect or modify the command before it
runs.

---

## Selectors

| Selector                | Meaning                                                |
|-------------------------|--------------------------------------------------------|
| *(none)*                | Newest open handoff. Same as `latest`.                 |
| `latest`                | Newest open handoff.                                   |
| `N` (positive integer)  | The Nth newest open handoff (1-based).                 |
| `h_…`                   | Exact handoff id. Matches any status (incl. completed).|

"Open" means `status` is `recorded` or `spawning`. Completed and failed
handoffs are excluded from `latest` and numeric selection on purpose —
those are for the most common case ("what did I just queue?").

Sort order: `created_at` descending, with `id` descending as a tiebreaker
so the result is stable across calls within the same millisecond.

---

## What the printed command looks like

The command line is derived from the envelope, not guessed. For a Codex
target with `model: gpt-5.5`, `effort: high`, `execution_mode: patch`:

```
codex exec --model gpt-5.5 -c model_reasoning_effort=high --sandbox workspace-write …
```

For a Claude target with `model: claude-opus-4-7`, `effort: medium`,
`execution_mode: plan`:

```
claude -p … --model claude-opus-4-7 --permission-mode plan --max-turns 50 --output-format text
```

Mapping from envelope fields to CLI flags:

| Envelope field   | Codex flag                                  | Claude flag                                      |
|------------------|---------------------------------------------|--------------------------------------------------|
| `model`          | `--model <model>`                           | `--model <model>`                                |
| `effort`         | `-c model_reasoning_effort=<effort>`        | *(advisory only)*                                |
| `execution_mode` | `--sandbox read-only` / `workspace-write`   | `--permission-mode plan` / `acceptEdits` / `--allowed-tools` |
| `task_*`         | rendered prompt passed via stdin            | rendered prompt passed via `-p`                  |
| `working_dir`    | `cd <dir> &&` prefix                        | `cd <dir> &&` prefix                             |

Anything that has no native flag (per-file allowlists, Claude `effort`,
free-form `constraints`) ends up only in the rendered prompt — same
behavior as `auto_spawn` and as the source agent's printed
`launch_command`.

---

## Errors

`relayos launch` exits non-zero with a single line on stderr:

| Exit code | Condition                                    | Message                                                        |
|-----------|----------------------------------------------|----------------------------------------------------------------|
| `1`       | No open handoffs                             | `relayos launch: no open handoffs found`                       |
| `1`       | `N` is past the end of the open list         | `relayos launch: handoff selection N is out of range; …`       |
| `1`       | `h_…` id does not exist                      | `relayos launch: handoff <id> was not found`                   |
| `1`       | Anything other than `launch` (or too many args) | `usage: relayos launch [latest|N|handoff_id]`                  |

The CLI never deletes, mutates, or writes anything. The worst it can do
is print the wrong command if your `$HANDOFF_DIR` points somewhere
unexpected — run `relayos doctor` or `inspect_config` from a connected
MCP host to confirm the resolved storage path.

---

## Setup

`relayos launch` ships in the same npm package as the MCP server. After
`npm run build` you have two options:

1. **Local path.** From the repo:

   ```bash
   ./bin/relayos launch
   ```

2. **Global symlink.** Once, in the repo:

   ```bash
   npm link
   ```

   then from anywhere:

   ```bash
   relayos launch
   ```

   The wrapper at `bin/relayos` resolves symlinks in a POSIX-portable
   way (no `readlink -f`), so global installs and `npm link` both work
   on macOS and Linux.

The CLI honors `$HANDOFF_DIR` exactly like the MCP server does. If your
host configures the MCP server with `HANDOFF_DIR=/some/other/path`,
export the same value in the shell where you run `relayos launch`.

---

## Why print-only

A spawning CLI is one typo away from running the wrong agent against
the wrong working tree. Print-only keeps the audit invariant simple:
**no command leaves RelayOS without a human pasting it.** Source agents
that need to spawn can still do so via `auto_spawn: true` on
`create_handoff` — that path captures stdout/stderr and updates audit
events. `relayos launch` is the boring, safe, scriptable alternative.

If you want a "print and immediately exec" flow, wrap it yourself:

```bash
$(relayos launch)
```

That keeps the decision to actually run in your shell, not in RelayOS.

---

## See also

- [`docs/QUICK_DEMO.md`](./QUICK_DEMO.md) — a 5-step Claude → RelayOS → Codex walkthrough that uses `relayos launch`.
- [`docs/ROOKIE_MODE.md`](./ROOKIE_MODE.md) — the supported chat-only workflow.
- [`README.md`](../README.md) — install, MCP wiring, envelope schema, and the full tools table.
