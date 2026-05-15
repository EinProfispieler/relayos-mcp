# Rookie Mode

**Talk to one Claude session. RelayOS coordinates Codex (and optional
Claude review) through MCP tools.**

Rookie Mode is the supported workflow for users who don't want to think
about handoff envelopes, template names, or which CLI to invoke when.
You stay in your primary Claude Code session; Claude calls RelayOS MCP
tools on your behalf; Codex reads its own assignment when you flip to
the Codex terminal.

This is documentation — not a runtime feature. There is no orchestrator
process, no background agent, no UI. Everything described here uses MCP
tools that already ship in this repo.

Rookie Mode now includes a prompt-boundary risk gate. Before creating a
handoff, Claude should classify the request using
[Rookie Mode Risk Policy](./ROOKIE_MODE_RISK_POLICY.md), then choose the
safest existing template and scope constraints for that risk level.

---

## Mental model

```
┌──────────────────┐         ┌─────────────┐         ┌──────────────────┐
│  You (chat)      │ ──────▶ │  Claude     │ ──MCP──▶│  RelayOS         │
└──────────────────┘         │  Code       │         │  (envelope on    │
                             │  session    │         │   disk)          │
                             └─────────────┘         └──────────────────┘
                                                              │
                                                              │ on-disk
                                                              ▼
                             ┌─────────────┐         ┌──────────────────┐
                             │  Codex      │ ──MCP──▶│  read_latest_    │
                             │  terminal   │         │  handoff         │
                             └─────────────┘         └──────────────────┘
```

You only ever type into the **left box**. Claude turns "ask Codex to
fix X" into a recorded handoff envelope. The next time you touch the
Codex terminal, Codex asks RelayOS what was queued for it and starts
work. Nothing runs without you switching windows — Rookie Mode is
deliberate, not autonomous.

---

## One-time setup

1. **Install RelayOS** in both clients (see [README → Install](../README.md#1-install)).
   Both Claude Code and Codex CLI must have the `relayos-mcp` server
   registered. This step is the only one that touches MCP config.

2. **Drop the orchestrator subagent into Claude Code:**
   ```
   cp examples/claude-subagents/relayos-orchestrator.md ~/.claude/agents/
   ```
   This is a vanilla [Claude Code subagent](https://docs.claude.com/en/docs/claude-code/sub-agents)
   — a Markdown file with frontmatter. It tells Claude how and when to
   call `create_quick_handoff`. You can edit it; it has no hidden state.

3. **In each project where Codex should pick up handoffs**, copy the
   Codex-side AGENTS.md:
   ```
   cp examples/codex/AGENTS.md /path/to/your/project/
   ```
   Or merge its contents into your existing `AGENTS.md`. This tells
   Codex to call `read_latest_handoff` at the start of a session, and
   how to interpret the envelope it gets back.

That's the whole setup. There is no daemon to start.

If something doesn't seem wired up right — Codex isn't seeing the
handoff, the wrong template seems to be picked, the storage path looks
wrong — ask Claude to call `doctor`. It runs health checks
(config loadable, storage writable, templates loaded, version
consistency, etc.) and reports what's broken without crashing on bad
state.

## Overseer-bound MCP bootstrap

For overseer-bound sessions, start by calling
`read_overseer_handshake` once. This is the canonical MCP bootstrap
tool for overseer session binding.
If you need a copy-paste AGENTS wake block for a project, use
`relayos overseer wake-instructions` or
`relayos overseer init --project --dry-run` (preview only, no writes).
Those outputs include Codex App safe defaults: `Approval = On request`,
`Sandbox = Read only`, ordinary Overseer startup stays read-only, temporary
`workspace-write` is only for approved scoped implementation or
validation-only build/test/typecheck writes, and commit/push/tag/release
still require separate explicit approval.
Current overseer MCP surface for this flow:

- `read_overseer_bootstrap_prompt` (optional ready-to-use startup prompt helper)
- `read_overseer_handshake` (canonical bootstrap)
- `write_overseer_note` (optional local progress note append)
- `read_overseer_recent` (optional read-only compact session readback)

- A separate `read_overseer_context` MCP tool is intentionally not
  needed; handshake already includes context completeness and required
  files.
- Optionally call `read_overseer_bootstrap_prompt` to retrieve a
  read-only startup prompt and recommended first calls.
- If `ok` or `context_complete` is false, report missing files and ask
  the user whether to proceed before acting.
- Treat `must_read`, `next_action_source`, `forbidden_actions`, and
  `requires_explicit_user_approval_for` as the active session contract.
- Use `write_overseer_note` only after handshake when you want to append
  local gitignored overseer timeline notes.
- Use `read_overseer_recent` only after handshake when you want a
  read-only compact view of local overseer state and recent notes.
- Do not assume RelayOS is a daemon, autonomous agent, or hard security
  sandbox, runtime activator, or automatic orchestrator.
- Never proceed with forbidden actions without explicit user approval.

Minimal copy-paste prompt:

`Call read_overseer_handshake first. If ok/context_complete is true, follow the returned session contract. If incomplete, report missing files before acting.`

### MCP smoke verification

After `npm run build`, restart Claude Code/Codex so they reload
`dist/index.js`. RelayOS MCP runs via stdio registration (not a
daemon/background service).

1. Confirm RelayOS tools are visible in the MCP client.
2. Call `read_overseer_handshake {}`.
3. If `ok` or `context_complete` is false, report `missing` and ask the user before proceeding.
4. Call `read_overseer_recent { "limit": 5 }`.
5. Optionally call `write_overseer_note { "text": "smoke: connected via MCP" }`.
6. Call `read_overseer_recent { "limit": 5 }` again and confirm the note appears.

This does not change safety posture: local-only overseer state, no
daemon, no automatic orchestration, no runtime activation, no security
sandbox, and forbidden actions still require explicit user approval.

---

## What you say in chat

You stay in Claude. Claude does the rest.

| You say                                                          | Claude does                                                                         |
|------------------------------------------------------------------|-------------------------------------------------------------------------------------|
| "Ask Codex to refactor `format.ts` to template literals."        | `create_quick_handoff` — `target_agent: codex`, mode default `patch`                |
| "Have Codex review the auth middleware for compliance."          | `create_quick_handoff` — `target_agent: codex, mode: review`                        |
| "Get Codex to run the unit tests under `tests/api/util`."        | `create_quick_handoff` — `target_agent: codex, mode: test`                          |
| "Plan the auth-middleware rewrite."                              | `create_quick_handoff` — `target_agent: claude, mode: plan` (uses `claude-plan`)    |
| "What did I just hand off?"                                      | `read_latest_handoff` — returns the envelope so Claude can summarize it             |

Claude prints the `handoff_id` and the `launch_command` after each
`create_quick_handoff`. You don't have to remember either — the next
section explains why.

---

## Risk gate before handoff

Before Claude creates a Rookie Mode handoff, it should classify the task
and route it conservatively:

- `risk_level`: `LOW` | `MEDIUM` | `HIGH` | `BLOCKED`
- `execution_mode`: `review-only` | `docs-only` | `test-only` |
  `patch` | `defer`
- `recommended_template`
- `recommended_model`
- `recommended_effort`
- why this routing is safe
- files or areas that must not be touched

These fields guide template choice and handoff boundaries; they are not
new envelope fields. Claude should include the relevant parts in the
handoff task, `allowed_files`, `forbidden_files`, and `constraints`.

Use the existing templates as the safe routing surface:

| Risk / intent                      | Execution guidance | Template                                  |
|------------------------------------|--------------------|-------------------------------------------|
| Narrow docs-only change            | `docs-only`        | `codex-patch` with docs-only constraints  |
| Focused test run                   | `test-only`        | `codex-test`                              |
| Read-only inspection               | `review-only`      | `codex-review`                            |
| Bounded implementation             | `patch`            | `codex-patch`                             |
| Unclear medium/high-risk work      | `review-only` or plan first | `codex-review` or `codex-plan`    |
| Unsafe or out-of-scope request     | `defer`            | no handoff                                |

`BLOCKED` tasks do not get a handoff. Examples include secrets access,
requests to bypass auditability, destructive work without explicit
approval, or work that would add a runner, UI, cloud service, account
system, pricing/licensing, automatic release flow, or schema-breaking
storage/envelope/audit change when those are out of scope.

For `HIGH` risk tasks, Claude should default to `codex-review` or
`codex-plan`; it should only queue `codex-patch` when the user has
provided explicit scope, protected areas, and verification expectations.
Rookie Mode should never auto-select `xhigh` or `max`; those remain
explicit lower-level overrides.

---

## What happens on the Codex side

When you switch to your Codex terminal and start `codex`, Codex reads
the `AGENTS.md` you dropped earlier and runs:

```json
read_latest_handoff { "assigned_to": "codex" }
```

Three outcomes:

1. **Envelope returned.** Codex now knows the task title, description,
   `allowed_files`, `forbidden_files`, `constraints`, and
   `expected_output`. It executes within those bounds and produces the
   expected output (e.g. a unified diff plus summary for `patch` mode).

2. **`{ envelope: null, events: [] }`.** Nothing is queued. Codex says
   so and waits for instructions.

3. **Envelope is for someone else.** With the `assigned_to: "codex"`
   filter, this can't happen — Codex sees only its own handoffs.

You can poll: re-run `read_latest_handoff` whenever you want to check
for new work. There is no push, no notification, no background loop —
that is intentional.

---

## Optional: Claude review of Codex's output

Same flow, reversed roles. Inside the Claude session, after Codex
finishes:

> "Have Claude review the diff Codex just produced."

Claude calls `create_quick_handoff` with `target_agent: claude,
mode: review`, which resolves to the built-in `claude-review` template.
The review handoff is an envelope on disk just like any other; Claude
(in this session, or a separate one) can pick it up via
`read_latest_handoff` with `assigned_to: "claude"`.

Review-mode handoffs should use the compact decision report specified by
the built-in `codex-review` and `claude-review` templates: start with
`OVERALL` and `ACTION`, include only blockers or the top warnings, and
avoid line-by-line PASS findings unless they explain a warning or
failure.

---

## Limits — and when to graduate out of Rookie Mode

Rookie Mode covers the common case. Step up to a lower-level tool when
any of these is true:

- You want a **template that isn't built in** (project-specific
  defaults, custom `expected_output`, custom `forbidden_files`). Use
  `create_handoff_from_template` with a `.relayos/config.json` template.
  See [README → Project config](../README.md#project-config--relayosconfigjson-optional).

- You want a `target_agent` + `mode` combination that has **no
  built-in template** (e.g. `claude` + `patch`, `claude` + `test`).
  `create_quick_handoff` will throw `quick_handoff_no_template` for
  these — that's the signal to use a project template or
  `create_handoff` directly.

- You need **full envelope control** — custom `effort`,
  `execution_mode: read_only`, exotic `model`, hand-tuned
  `expected_output`. Use `create_handoff` and pass every field
  yourself. See [README → When to call `create_handoff`
  directly](../README.md#handoff-envelope).

- You want **auto-spawn** (Claude immediately runs Codex without you
  switching terminals). The Rookie Mode subagent intentionally leaves
  `auto_spawn` off. Edit the subagent — or call `create_handoff`
  directly with `auto_spawn: true` — when you want that behavior, and
  understand the audit-trail implications.

---

## Troubleshooting

A few snags surface often enough that they're worth calling out — all
of them are environmental, not RelayOS bugs.

- **You upgraded RelayOS but the new tools don't appear.** MCP clients
  cache the tool list at session start. After `git pull && npm run build`
  to a newer version, restart Claude Code (and Codex) so the host
  re-introspects the server. Until you restart, calls to tools added in
  the new version will fail with "tool not found" even though
  `dist/index.js` exposes them.

- **Other MCP servers are erroring and the dogfood feels broken.**
  Failures in unrelated MCP servers (Codex MCP integrations, third-party
  tool servers) can spam the host's MCP error pane and make it unclear
  whether RelayOS is the problem. When isolating a RelayOS issue,
  temporarily disable unrelated MCP servers in `~/.claude.json` /
  `~/.codex/config.toml` and try again.

- **`cli_detection.found: false` in a `create_*_handoff` response.**
  This is informational, not an error. RelayOS looked for the target's
  CLI binary (e.g. `codex`) in `PATH` at handoff creation time and did
  not find it. The envelope is still recorded and the `launch_command`
  is still printed; you (or the target agent in its own session) can
  run it manually. `auto_spawn: true` is the only path that actually
  needs the binary at creation time.

If something still looks wrong, ask Claude to call `doctor` for a
nine-check health report and `inspect_config` for the resolved config —
`inspect_config` is read-only, and both degrade gracefully.

---

## Files in this guide

- `docs/ROOKIE_MODE.md` — this file.
- `examples/claude-subagents/relayos-orchestrator.md` — drop-in
  Claude Code subagent.
- `examples/codex/AGENTS.md` — drop-in Codex-side instruction file.

All three are documentation. Editing them does not change RelayOS
behavior; they only change what Claude or Codex chooses to do at the
prompt boundary.

## Related docs

Future roadmap/design notes (not current shipped runtime features):

- [ROADMAP.md](./ROADMAP.md)
- [HANDOFF_RUN_CONTRACT.md](./HANDOFF_RUN_CONTRACT.md) — future run completion/result evidence contract (not current runner/daemon support)
- [ROOKIE_MODE_FUTURE.md](./ROOKIE_MODE_FUTURE.md)
- [CURATED_MEMORY.md](./CURATED_MEMORY.md)
- [SCOPED_ROOKIE_RUNTIME.md](./SCOPED_ROOKIE_RUNTIME.md)
