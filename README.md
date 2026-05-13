# RelayOS

> **A local-first MCP control layer for structured handoffs between AI coding agents.**

RelayOS is an MCP server that runs on your machine. It turns "ask Codex to
refactor this" or "have Claude review that" into a recorded, validated
handoff — instead of a copy-pasted prompt you hope the other agent reads
correctly. It registers in both Claude Code and Codex CLI over stdio, so the
source agent files the handoff and the target agent picks it up through the
same tool, in the same format, with the same audit trail every time.

**The problem.** When you switch between Claude Code and Codex CLI today, the
handoff is a chat-window paste. Model choice gets dropped. Reasoning effort is
guessed. File scope is implied. Expected output is fuzzy. Nothing is logged.
If something goes wrong, you cannot tell which agent did what, with which
model, or under what constraints.

**Structured handoff.** RelayOS replaces the paste with a validated envelope:
`model`, `effort`, `execution_mode`, `allowed_files`, `forbidden_files`,
`constraints`, `expected_output`. The envelope is written to disk under
`$HANDOFF_DIR` (default `~/.claude/handoff/`), every event is appended to an
append-only audit log, and the target agent reads its own assignment via MCP.
No chat-window paste, no lost fields. Local-first: nothing leaves your
machine, no cloud, no account, no telemetry.

Record-only by default. `auto_spawn` is opt-in per call and never default.

## How it fits together

```
   ┌────────────┐
   │    You     │  "Ask Codex to refactor format.ts"
   └─────┬──────┘
         ▼
   ┌────────────┐     MCP      ┌──────────────────────────────┐
   │  Claude    │  ─────────▶  │  RelayOS                     │
   │  Code      │ create_      │   envelope on disk           │
   │  session   │  handoff     │   + audit.jsonl event        │
   └────────────┘              └──────────────┬───────────────┘
                                              │  on disk
                                              ▼
   ┌────────────┐     MCP      ┌──────────────────────────────┐
   │  Codex     │  ─────────▶  │  read_latest_handoff         │
   │  CLI       │ read_latest_ │   returns the envelope with  │
   │  session   │  handoff     │   full task + scope + output │
   └────────────┘              └──────────────────────────────┘
```

You stay in one chat. Claude files the handoff. Codex reads it the next time
you switch terminals. Nothing runs automatically — switching windows is the
trigger.

## Rookie Mode

Rookie Mode is the supported workflow for users who do not want to think
about handoff envelopes, template names, or which CLI to invoke when. You
talk to one Claude Code session; Claude calls `create_quick_handoff` for
you; Codex reads its assignment via `read_latest_handoff` when you switch
to the Codex terminal. Two drop-in files do the wiring: a Claude Code subagent
([`examples/claude-subagents/relayos-orchestrator.md`](examples/claude-subagents/relayos-orchestrator.md))
and a Codex `AGENTS.md` snippet
([`examples/codex/AGENTS.md`](examples/codex/AGENTS.md)). Full walkthrough:
[**docs/ROOKIE_MODE.md**](docs/ROOKIE_MODE.md).

## Quick start

```bash
git clone https://github.com/EinProfispieler/relayos-mcp.git
cd relayos-mcp
npm install
npm run build
./scripts/install.sh   # prints MCP snippets to paste into your clients
```

1. Paste the printed `relayos` block into `~/.claude.json` (under
   `mcpServers`) and into `~/.codex/config.toml`. Restart both CLIs so they
   re-read the tool list.
2. Drop the two Rookie Mode files in:
   `examples/claude-subagents/relayos-orchestrator.md` →
   `~/.claude/agents/`; `examples/codex/AGENTS.md` → your project root (or
   merge into an existing `AGENTS.md`).
3. In a Claude Code session, say:
   *"Ask Codex to refactor `src/api/util/format.ts` to template literals."*
   Claude files the handoff. Open a Codex terminal in the same project and
   start `codex` — it reads the assignment and goes.

Detailed install snippets, the full tools table, and end-to-end examples are
below.

## What's in v0.4.1

Fourteen MCP tools, grouped by purpose:

- **Creating handoffs.** `create_quick_handoff`,
  `create_handoff_from_template`, `create_handoff` — from one-shot to fully
  manual.
- **Reading handoffs.** `read_latest_handoff`, `read_handoff`,
  `list_open_handoffs`, `list_handoffs` — what is queued, what is done.
- **Rendering & validation.** `validate_handoff`, `render_claude_prompt`,
  `render_codex_prompt` — dry-run envelopes and inspect rendered prompts.
- **Audit.** `write_audit_log` — append a custom event to an existing
  handoff.
- **Diagnostics.** `doctor`, `inspect_config`, `list_templates` —
  health checks, effective config, and template discovery.

Full table with descriptions: see [Tools](#tools) below.

## Scope (v1)

RelayOS v1 is intentionally narrow. The OSS core covers the Claude Code ↔
Codex CLI handoff and nothing else. RelayOS is **not** a chat bridge, a
session-level coordinator, or a multi-agent chat room — it controls one
thing: how a single task gets handed from one coding agent to another.

**In scope**

- Claude Code (`claude` CLI)
- Codex CLI (`codex` CLI)
- One MCP server binary, registered in both clients over stdio

**Out of scope for v1** (no plans to add via this OSS repo)

- GLM, Cursor, Gemini, OpenCode, Windsurf, or any other agent
- General multi-agent orchestration / chat-level back-and-forth between agents
- Cross-host transport (stdio only)
- Web UI, TUI, dashboard
- Auto-commit, auto-push, auto-merge
- Full filesystem sandbox (native flags are best-effort; prompt-level enforcement is the floor)

---

## Install

```bash
git clone https://github.com/EinProfispieler/RelayOS.git && cd RelayOS
npm install
npm run build           # produces dist/index.js
./scripts/install.sh    # prints registration snippets for your MCP clients
```

`install.sh` prints the snippets you paste into your MCP client configs. It does
**not** edit those files automatically — they usually contain other servers.

Run `./scripts/install.sh` after `npm run build` — it prints the snippets below
with the absolute path of your local `dist/index.js` filled in.

### Claude Code (`~/.claude.json` → `mcpServers`)

```json
"relayos": {
  "type": "stdio",
  "command": "node",
  "args": ["/absolute/path/to/relayos-mcp/dist/index.js"]
}
```

### Codex CLI (`~/.codex/config.toml`)

```toml
[mcp_servers.relayos]
type = "stdio"
command = "node"
args = ["/absolute/path/to/relayos-mcp/dist/index.js"]
```

Override storage path via the `HANDOFF_DIR` env var (default `~/.claude/handoff/`).

> **Upgrading?** MCP clients capture the tool list when they start the
> server. After `git pull && npm run build` to a new RelayOS version,
> **restart your Claude Code (and Codex) session** — otherwise newly
> added tools (e.g. `doctor`, `inspect_config`, `list_open_handoffs`
> from v0.4.0) will not appear in the host's tool list even though
> `dist/index.js` exposes them.

---

## Tools

| Tool                   | Purpose                                                       |
|------------------------|---------------------------------------------------------------|
| `create_handoff`       | Validate + record an envelope; optionally spawn the target.   |
| `list_templates`               | List built-in + project handoff templates.                    |
| `create_handoff_from_template` | Create a handoff from a named template + short task string.   |
| `create_quick_handoff`         | One-shot: pick a template from `target_agent` + `mode`.       |
| `validate_handoff`     | Pure schema check, no side effects.                           |
| `render_claude_prompt` | Render the prompt + `claude -p` argv for an envelope.         |
| `render_codex_prompt`  | Render the prompt + `codex exec` argv for an envelope.        |
| `write_audit_log`      | Append a custom audit event to an existing handoff.           |
| `list_handoffs`        | List envelopes (newest first), filter by source/target/status.|
| `read_handoff`         | Return one envelope + all its audit events.                   |
| `read_latest_handoff`  | Return the most recent open handoff (filter by `assigned_to`).|
| `list_open_handoffs`   | List open handoff summaries (`recorded`+`spawning`) — no full envelope leak. |
| `inspect_config`       | Show the effective RelayOS config (source, storage dir, templates, warnings). |
| `doctor`               | Run nine health checks; never throws on broken state. |

### Diagnostics

If something doesn't look right — an envelope isn't appearing, the wrong
template is winning, the server seems to be using a config you didn't
write — call `doctor` for a one-shot health report and `inspect_config`
to see the resolved config (including any project templates that shadow
built-ins). `inspect_config` is read-only, and both tools degrade gracefully on broken
state: malformed `config.json` is reported as a structured error rather
than crashing the call. `list_open_handoffs` returns lightweight
summaries (no full envelopes) when you just want to see what's queued.

### Optional: slash-command shortcuts

Slash commands are not bundled or required. If you want a one-keystroke
wrapper around `create_handoff_from_template`, drop a Markdown file in
`~/.claude/commands/` that instructs Claude to call the tool with a
fixed template name. There is no install step in this repo for slash
commands — `list_templates` + `create_handoff_from_template` is the
supported interface.

### The handoff envelope

```ts
{
  source_agent:     "claude" | "codex",
  target_agent:     "claude" | "codex",
  model:            string,
  effort:           "max" | "xhigh" | "high" | "medium" | "low",
  execution_mode:   "read_only" | "plan" | "patch" | "test" | "review",
  task_title:       string,
  task_description: string,
  allowed_files:    string[],   // globs; [] = no restriction
  forbidden_files:  string[],
  constraints:      string[],
  expected_output:  string | string[],
  working_dir?:     string,
  auto_spawn?:      boolean,    // default false
  audit_metadata?: { parent_handoff_id?, source_session_id?, tags? }
}
```

When `auto_spawn=false` (the default), RelayOS validates, writes the envelope,
appends audit lines, and returns a ready-to-paste `launch_command` — the source
agent (or you) runs the target itself.

`validate_handoff` accepts candidate envelopes wrapped as `{ "payload": ... }`
so MCP clients pass the full candidate through to RelayOS for validation. Legacy
direct input is still accepted for v0.1.x compatibility, but new callers should
use the wrapped form.

When `auto_spawn=true`:

- Missing target CLI → **hard fail** with `error.code = "missing_target_cli"`. The
  envelope is still recorded; the audit log gets `spawn_failed:missing_target_cli`.
- CLI present → RelayOS spawns the target, captures stdout/stderr to
  `${HANDOFF_DIR}/envelopes/{id}.stdout.log` and `.stderr.log`, and returns the
  final envelope status with last-16 KB tails.

### Storage layout

```
$HANDOFF_DIR/                    # default: ~/.claude/handoff/
├── audit.jsonl                  # append-only, one JSON event per line
└── envelopes/
    ├── h_01HQ….json             # full envelope
    ├── h_01HQ….stdout.log       # only when spawned
    └── h_01HQ….stderr.log
```

### Scope enforcement

v1 is **best-effort native flags + always advisory prompt**:

- `allowed_files` / `forbidden_files` / `constraints` are **always injected into
  the rendered target prompt** and **always recorded in the audit log**.
- Native CLI flags are applied **when the adapter clearly supports them**:
  - `effort` → `codex exec -c model_reasoning_effort=...` (native on Codex).
  - `execution_mode` → `--sandbox read-only|workspace-write` on Codex;
    `--permission-mode plan|acceptEdits` and (for `read_only`) `--allowed-tools` on Claude.
- When a constraint has no native enforcement (e.g. per-file allowlists, Claude's
  effort), `advisory_only_enforcement` is logged with the specific note.
- RelayOS does **not** build a filesystem sandbox in v1.

## Templates and project config

Most callers should not write a full handoff envelope by hand. Instead,
use the template tools: pick a named template and pass the user's task
as plain text. RelayOS fills `model`, `effort`, `execution_mode`,
`allowed_files`, `forbidden_files`, `constraints`, and `expected_output`
from the template, layered with optional project config and call-time
overrides.

> **Core uses static, reliability-first defaults.** Each built-in
> template carries a fixed `model` and `effort` chosen to bias toward a
> good result rather than the lowest cost. No built-in defaults to
> `max` or `xhigh`. RelayOS Core never auto-selects `max`. Cost-aware
> model + effort routing, budgets, historical success/failure
> statistics, automatic downgrade for simple tasks, and automatic
> escalation after failed attempts are **future Pro features and are
> not in this repository.** Use `overrides.model` and `overrides.effort`
> when you want to deviate from a template's defaults.

### Built-in templates

| Name            | target | execution_mode | model             | effort   |
|-----------------|--------|----------------|-------------------|----------|
| `codex-patch`   | codex  | `patch`        | `gpt-5-codex`     | `high`   |
| `codex-review`  | codex  | `review`       | `gpt-5-codex`     | `medium` |
| `codex-test`    | codex  | `test`         | `gpt-5-codex`     | `medium` |
| `codex-plan`    | codex  | `plan`         | `gpt-5-codex`     | `high`   |
| `claude-review` | claude | `review`       | `claude-opus-4-7` | `medium` |
| `claude-plan`   | claude | `plan`         | `claude-opus-4-7` | `high`   |

`codex-patch` is the default for code-patch handoffs. There is no
built-in `claude-patch` template; define one in project config if you
need it.

`xhigh` is a valid effort *override*, but no built-in template defaults
to `xhigh`. `max` is a valid override at the RelayOS layer — Core
passes it through to the target CLI — but Core itself never selects
`max` automatically. If you want max, you ask for max.

### Project config — `.relayos/config.json` (optional)

Place a JSON file at `.relayos/config.json` in your project root (or
anywhere up the directory tree from cwd). RelayOS finds it
automatically. Override with `RELAYOS_CONFIG=/abs/path/to/file.json`.

```json
{
  "version": 1,
  "defaults": {
    "forbidden_files": [".env*", "secrets/**", "**/node_modules/**", "**/dist/**"],
    "constraints": ["No new dependencies without approval."]
  },
  "templates": {
    "codex-patch": {
      "allowed_files": ["src/**", "tests/**"],
      "effort": "high"
    },
    "internal-migration": {
      "target_agent": "codex",
      "model": "gpt-5-codex",
      "effort": "high",
      "execution_mode": "patch",
      "expected_output": [
        "A unified diff scoped to migrations/**.",
        "A rollback note."
      ]
    }
  }
}
```

Merge order (lowest precedence first):

1. Built-in template
2. Project `defaults` (extends list-shaped fields like `forbidden_files`)
3. Project per-template overrides (`templates.<name>`)
4. Call-time `overrides` in `create_handoff_from_template`

### Tool: `list_templates`

```json
{ "target_agent": "codex" }
```

Returns all available templates, each tagged `source: "builtin" | "project"`.
Optional `target_agent` filter.

### Tool: `create_handoff_from_template`

```json
{
  "template": "codex-patch",
  "task": "Fix validate_handoff so MCP clients can wrap the candidate in { payload } without losing fields. Add a regression test.",
  "overrides": {
    "allowed_files": ["src/tools/validate_handoff.ts", "tests/tools.test.ts"]
  }
}
```

Returns the same shape as `create_handoff`: `handoff_id`, `envelope_path`,
`launch_command`, and (when `auto_spawn: true`) spawn results. The
envelope's `audit_metadata.tags` includes `template:<name>` so you can
trace which template each handoff came from.

`task_title` is derived from the first line of `task` (truncated to 80
characters, trailing punctuation stripped) unless you pass an explicit
`task_title`.

### When to call `create_handoff` directly

Use `create_handoff` (the low-level API) when you need full control of
every envelope field — no template, no project config interference. The
two APIs produce identical envelope files; templates are purely an
ergonomics layer.

---

## Examples

All examples use `create_handoff`. Each shows the JSON payload + the resulting
`launch_command` you'd see in the response.

### A. Claude → Codex patch (record-only)

```json
{
  "source_agent": "claude",
  "target_agent": "codex",
  "model": "gpt-5-codex",
  "effort": "high",
  "execution_mode": "patch",
  "task_title": "Refactor format helpers to template literals",
  "task_description": "Replace string concatenation in src/api/util/format.ts with template literals. Behavior must be identical; update unit tests if assertions need updating.",
  "allowed_files": ["src/api/util/**/*.ts", "tests/api/util/**"],
  "forbidden_files": [".env*", "secrets/**"],
  "constraints": ["No new dependencies", "Keep public exports stable"],
  "expected_output": ["A unified diff.", "A one-paragraph summary."]
}
```

Rendered `launch_command`:

```
codex exec --model gpt-5-codex -c model_reasoning_effort=high --sandbox workspace-write --skip-git-repo-check '<prefixed prompt with HANDOFF header, scope, constraints, task>'
```

### B. Codex → Claude review (record-only)

```json
{
  "source_agent": "codex",
  "target_agent": "claude",
  "model": "claude-opus-4-7",
  "effort": "medium",
  "execution_mode": "review",
  "task_title": "Review the auth-middleware rewrite for compliance gaps",
  "task_description": "Read src/auth/middleware.ts and the related tests, and report any places where session tokens are persisted in ways that violate the new compliance policy.",
  "allowed_files": ["src/auth/**", "tests/auth/**"],
  "forbidden_files": ["**/node_modules/**"],
  "constraints": ["Cite file:line for every finding"],
  "expected_output": "A bulleted list of findings, each with severity and file:line."
}
```

Rendered `launch_command`:

```
claude -p '<prefixed prompt …>' --model claude-opus-4-7 --permission-mode plan --max-turns 50 --output-format text
```

### C. Record-only (no spawn)

Identical to A or B with `auto_spawn` omitted or set to `false`. RelayOS returns
the envelope path + `launch_command` and writes a `created` + `validated` audit
event. **No subprocess runs.** The source agent (or you) executes the
`launch_command` when ready.

### D. Auto-spawn

```json
{
  "source_agent": "claude",
  "target_agent": "codex",
  "model": "gpt-5-codex",
  "effort": "medium",
  "execution_mode": "test",
  "task_title": "Run the unit tests under tests/api/util",
  "task_description": "Run `npx vitest run tests/api/util` and report the result.",
  "allowed_files": ["tests/api/util/**"],
  "forbidden_files": [],
  "constraints": [],
  "expected_output": "Exit code + summary of failures (if any).",
  "auto_spawn": true
}
```

Response (abridged):

```json
{
  "handoff_id": "h_01HQ…",
  "envelope_path": "/Users/you/.claude/handoff/envelopes/h_01HQ….json",
  "launch_command": "codex exec …",
  "status": "completed",
  "cli_detection": {
    "target_binary": "codex",
    "found": true,
    "resolved_path": "/opt/homebrew/bin/codex"
  },
  "spawn": {
    "started_at": "2026-05-13T03:00:00.000Z",
    "finished_at": "2026-05-13T03:00:42.123Z",
    "exit_code": 0,
    "duration_ms": 42123,
    "stdout_tail": "…",
    "stderr_tail": ""
  }
}
```

Matching audit events:

```
{"ts":"…","handoff_id":"h_01HQ…","event":"created", …}
{"ts":"…","handoff_id":"h_01HQ…","event":"validated", …}
{"ts":"…","handoff_id":"h_01HQ…","event":"advisory_only_enforcement", …}
{"ts":"…","handoff_id":"h_01HQ…","event":"spawn_started", …}
{"ts":"…","handoff_id":"h_01HQ…","event":"spawn_completed", …}
```

### E. End-to-end: Claude asks Codex to do X

The friction-free path for "ask Codex to fix X" requests. Three messages,
no envelope id ever pasted by the user.

**1. User → Claude (in the Claude Code session):**

> Ask Codex to refactor the format helpers in `src/api/util/format.ts` to
> template literals.

**2. Claude → MCP** (`create_handoff_from_template`):

```json
{
  "template": "codex-patch",
  "task": "Refactor src/api/util/format.ts to use template literals. Behavior must be identical; update unit tests if assertions need updating.",
  "overrides": {
    "allowed_files": ["src/api/util/**/*.ts", "tests/api/util/**"]
  }
}
```

Response (abridged):

```json
{
  "handoff_id": "h_01HQ…",
  "envelope_path": "/Users/you/.claude/handoff/envelopes/h_01HQ….json",
  "launch_command": "codex exec --model gpt-5-codex …",
  "status": "recorded"
}
```

`auto_spawn` is off (the template default), so nothing has been launched —
the envelope is just on disk.

**3. Codex → MCP** (`read_latest_handoff`), in the Codex CLI session:

```json
{ "assigned_to": "codex" }
```

Response (abridged):

```json
{
  "envelope": {
    "id": "h_01HQ…",
    "target_agent": "codex",
    "execution_mode": "patch",
    "task_title": "Refactor format helpers to template literals",
    "task_description": "Refactor src/api/util/format.ts …",
    "allowed_files": ["src/api/util/**/*.ts", "tests/api/util/**"],
    "expected_output": ["A unified diff.", "A one-paragraph summary."],
    "status": "recorded"
  },
  "events": [
    { "event": "created", … },
    { "event": "validated", … }
  ]
}
```

Codex now has its full assignment — task, scope, expected output —
without the user pasting a handoff id. If `envelope` is `null`, Codex
knows nothing is queued and can poll again later.

### F. One-shot quick handoff

Skip the template name. Pass `target_agent` + `task` and the server picks
a built-in template based on `target_agent` and (optional) `mode`.

```json
{
  "target_agent": "codex",
  "task": "Refactor src/api/util/format.ts to use template literals.",
  "allowed_files": ["src/api/util/**/*.ts", "tests/api/util/**"]
}
```

That's equivalent to `create_handoff_from_template` with
`template: "codex-patch"` (codex defaults to `patch`). Override `mode`
when you want a different built-in:

```json
{ "target_agent": "codex", "task": "Run unit tests under tests/api/util.", "mode": "test" }
{ "target_agent": "claude", "task": "Review the auth-middleware rewrite.", "mode": "review" }
{ "target_agent": "claude", "task": "Plan the auth-middleware rewrite." }
```

Mapping (modes: `patch`, `review`, `test`, `plan`):

| target / mode | patch         | review         | test         | plan         |
|---------------|---------------|----------------|--------------|--------------|
| `codex`       | `codex-patch` | `codex-review` | `codex-test` | `codex-plan` |
| `claude`      | _(error)_     | `claude-review`| _(error)_    | `claude-plan`|

Defaults: `codex` → `patch`, `claude` → `plan`. Unmapped combinations
(`claude` + `patch`, `claude` + `test`) throw `quick_handoff_no_template`
— use `create_handoff_from_template` with a project template, or
`create_handoff` for full envelope control.

---

## Open Source vs Future Paid Features

RelayOS is intentionally narrow at v1. The open-source core is everything you
need to use structured handoffs between Claude Code and Codex CLI safely and
auditably. The features listed under "Future Pro / Team" are **not implemented
in this repository** and are listed only to clarify scope — so contributors
don't waste effort on them and users know what to expect later.

### Open Source Core (this repo)

- Claude ↔ Codex structured handoff
- MCP server (stdio, registered in both clients from one binary)
- Validated handoff envelopes (Zod schema)
- Template-based handoff creation (`list_templates`, `create_handoff_from_template`, `create_quick_handoff`)
- Six built-in templates + optional `.relayos/config.json` project overrides
- `model` / `effort` / `execution_mode` fields
- `allowed_files` / `forbidden_files` scope (prompt-level + native flags where supported)
- JSONL append-only audit log
- Per-envelope JSON files on disk
- Record-only by default
- Optional `auto_spawn` per handoff

### Future Pro / Team (NOT in this repo)

- Project-level policies (e.g. "this repo's `patch` handoffs always require model X and effort ≥ high")
- Richer history search / queryable storage backend
- Cost & model-usage statistics across handoffs
- Dashboard / TUI
- PR integration (open a PR from a completed handoff, attach audit trail)
- Approval workflow (human-in-the-loop gate before spawn)
- Team audit export (SIEM-friendly formats)
- Enterprise policy controls (org-wide forbidden_files defaults, model allowlists)

If you want any of those today, they need to be built outside this repo or
behind a separate license.

---

## Development

```bash
npm install
npm test           # vitest run
npm run typecheck  # tsc --noEmit
npm run build      # tsup → dist/index.js
npm run dev        # tsx src/index.ts (run against a real MCP client over stdio)
```

`HANDOFF_DIR=/tmp/scratch npm test` writes all artifacts under `/tmp/scratch`.

---

## License

MIT
