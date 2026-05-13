# Quick demo: Claude → RelayOS → Codex in 5 steps

This walkthrough shows the shortest realistic path from "I want Codex to
do X" to a recorded, audited, runnable handoff. Everything stays on
your machine; nothing is auto-executed.

**Prereqs** (one-time):

- `npm install && npm run build` in this repo.
- RelayOS MCP server registered in both Claude Code and Codex CLI (see
  [README → Install](../README.md#install)).
- For the CLI part, either `./bin/relayos` from the repo or `npm link`
  for a global `relayos` command. See [`docs/LAUNCH.md`](./LAUNCH.md).

---

## 1. Ask in plain language (Claude Code session)

Open a Claude Code session in your project. Type:

> Ask Codex to refactor `src/api/util/format.ts` to template literals.

You don't need to remember template names, effort levels, or which
model to pick.

## 2. Claude files a handoff (under the hood)

Claude maps your sentence to a single MCP call:

```jsonc
create_quick_handoff {
  "target_agent": "codex",
  "mode": "patch",              // inferred from "refactor"
  "task": "Refactor src/api/util/format.ts to template literals."
}
```

RelayOS resolves this to the built-in `codex-patch` template, validates
the envelope, writes it to `~/.claude/handoff/envelopes/h_…json`, and
appends `created` + `validated` events to `audit.jsonl`. The response
includes the new `handoff_id` and a ready-to-paste `launch_command`.

Claude prints something like:

> Handoff `h_01HQ…` recorded. Launch with `codex exec --model gpt-5.5
> -c model_reasoning_effort=high --sandbox workspace-write …`

## 3. Switch to a Codex terminal

You're done talking to Claude for this task. Open a terminal in the
same project and run:

```bash
relayos launch
```

You get back the same `launch_command` Claude printed — derived from
the envelope, not retyped. If you want to see which handoff that maps
to:

```bash
relayos launch              # newest open handoff
relayos launch 1            # same thing, explicit
relayos launch h_01HQ…      # exact id, any status
```

`relayos launch` is print-only by default. It does not spawn anything.
That's intentional — see [`docs/LAUNCH.md`](./LAUNCH.md#why-print-only).

## 4. Run Codex

Run the printed command (or just `$(relayos launch)` to inline it).
Codex starts a session; the first thing it does is:

```jsonc
read_latest_handoff { "assigned_to": "codex" }
```

It gets back the full envelope: `task_description`, `allowed_files`,
`forbidden_files`, `constraints`, `expected_output`. It produces a
unified diff plus a one-paragraph summary (the `codex-patch`
`expected_output`).

## 5. Check the audit trail

Every step you just did was recorded. From the repo or anywhere `jq`
works:

```bash
tail -n 5 ~/.claude/handoff/audit.jsonl | jq -c '{ts, event, handoff_id}'
```

You'll see something like:

```jsonc
{"ts":"…","event":"created","handoff_id":"h_01HQ…"}
{"ts":"…","event":"validated","handoff_id":"h_01HQ…"}
{"ts":"…","event":"rendered_codex_prompt","handoff_id":"h_01HQ…"}
```

The full set of audit event kinds is defined in `src/schema.ts` as
`AuditEventKind`: `created`, `validated`, `rendered_claude_prompt`,
`rendered_codex_prompt`, `spawn_started`, `spawn_completed`,
`spawn_failed`, `advisory_only_enforcement`, `custom`.

For a richer view, ask Claude in any session: *"Read handoff
`h_01HQ…`"* — Claude calls `read_handoff` and gets the envelope plus
the full event timeline back in one shot.

---

## What you did not have to do

- Pick a template name.
- Write an envelope by hand.
- Copy-paste a multi-line prompt between Claude and Codex.
- Hope Codex picks the same model / effort / sandbox you intended.
- Trust a chat transcript to be your audit log.

That's the whole pitch. Everything else in the docs is variations on
this loop — different templates, different agents, project-specific
defaults, optional review passes — but the shape is always: source
agent files a handoff, target agent reads it, RelayOS records both
sides.

---

## See also

- [`docs/LAUNCH.md`](./LAUNCH.md) — selectors, error codes, and the print-only rationale.
- [`docs/ROOKIE_MODE.md`](./ROOKIE_MODE.md) — the supported chat-only workflow, including the risk gate.
- [`README.md`](../README.md) — install, MCP wiring, envelope schema, full tools table.
