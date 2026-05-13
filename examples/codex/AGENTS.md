# Codex agent: RelayOS Rookie Mode

This `AGENTS.md` is intended for projects where Codex picks up tasks
queued by Claude through RelayOS. Drop it at the project root, or
merge its content into your existing `AGENTS.md`.

It assumes the `relayos-mcp` MCP server is registered in your Codex
config (see `~/.codex/config.toml` per the RelayOS README).

## At session start

Before doing anything else in this project, call:

```
mcp__relayos__read_latest_handoff { "assigned_to": "codex" }
```

That tool returns one of:

- **`{ envelope, events }`** — the most recent open handoff assigned
  to Codex. Treat the envelope as your authoritative assignment for
  this session. Do not improvise an alternative task.

- **`{ envelope: null, events: [] }`** — nothing is queued. Tell the
  user there's no pending work and wait for direct instructions.

If you start work without checking RelayOS first, you may duplicate or
contradict work that Claude queued for you. Always check.

## Reading the envelope

When `envelope` is present, treat its fields as binding:

| Field              | What it means for you                                                |
|--------------------|----------------------------------------------------------------------|
| `task_title`       | Short imperative summary — confirm it back to the user verbally.     |
| `task_description` | The full task. This is the spec.                                     |
| `execution_mode`   | `patch` / `review` / `test` / `plan` — shapes your output.           |
| `allowed_files`    | If non-empty, do not read or modify files outside these globs.       |
| `forbidden_files`  | Never read, edit, or include in output. Includes `.env*` etc.        |
| `constraints`      | Hard rules — e.g. "no new dependencies". Treat as non-negotiable.    |
| `expected_output`  | What you must produce. Match this exactly in your final reply.       |

If `allowed_files` is empty, you may operate anywhere in the repo
*except* `forbidden_files`.

If a constraint conflicts with the task description, stop and ask the
user — do not silently relax the constraint.

## Producing the output

Your final reply must satisfy `expected_output` literally. For the
built-in modes that means:

- **`patch`** — produce a unified diff and a one-paragraph summary of
  the change. Run any tests that are obviously implicated; report
  results.
- **`review`** — produce a bulleted list of findings, each with
  severity (`info` / `warn` / `error`) and `file:line`.
- **`test`** — run the relevant tests, report exit code, and for each
  failure include the test name plus the first error line.
- **`plan`** — produce a step-by-step implementation plan with exact
  file paths and a verification command per step. Do not write code.

Project templates may override `expected_output`. When in doubt,
follow what's in the envelope, not what's in this document.

## Optional: report progress

After completing the assignment, you can append a custom audit event
so the next session can see what happened:

```
mcp__relayos__write_audit_log {
  "handoff_id": "<envelope.id>",
  "event_label": "codex_completed",
  "detail": { "summary": "<one line>" }
}
```

This is optional in v0.3.x — RelayOS does not currently change the
envelope status based on it. It is purely a breadcrumb in the audit
log for humans.

## What not to do

- **Do not call `create_handoff` or `create_quick_handoff` from
  inside Codex.** Codex is the consumer side of the handoff, not the
  producer. If you discover follow-up work, tell the user; let Claude
  queue the next handoff.

- **Do not skip the envelope.** If the user types a task that
  contradicts the queued envelope, stop and ask which takes
  precedence.

- **Do not widen scope.** `allowed_files` / `forbidden_files` /
  `constraints` are the contract. If the task can't be completed
  within them, report that as a finding rather than violating the
  contract.

- **Do not edit `.relayos/` or RelayOS storage directories.** Those
  are RelayOS state, not project source.
