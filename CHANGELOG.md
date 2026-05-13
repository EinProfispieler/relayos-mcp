# Changelog

## v0.4.0

- Added MCP tool `inspect_config` — read-only diagnostic that returns the
  effective RelayOS configuration: `config_source`
  (`explicit-env` / `upward-search` / `default`), `config_path`,
  `storage_dir`, the set of built-in/project/shadowed templates, the parsed
  config object, and any warnings. On malformed or invalid config it
  returns a structured `{ status: "error", error: { type, message, path? } }`
  result instead of throwing — safe to call when something is broken.
- Added MCP tool `doctor` — read-only health check that runs nine
  diagnostic checks (config loadable, storage path/listable/writable,
  built-in templates, project templates, `list_handoffs`,
  `read_latest_handoff` shape, package/server version consistency) and
  returns `{ status: "pass" | "warn" | "fail", server_version, checks }`.
  Overall status is the worst of any individual check. Never throws on
  broken state — failures are reported as `fail` checks with `detail`.
- Added MCP tool `list_open_handoffs` — read-only diagnostic that returns
  lightweight summaries of open handoffs (status `recorded` or
  `spawning`) with `id`, `title`, `assigned_to`, `status`, `created_at`,
  `tags`, and `path`. Never returns full envelopes. Optional
  `assigned_to: string` (accepts `"codex"`, `"claude"`, or any other
  agent name — not enum-restricted, so future agents like `cursor`
  won't require a breaking change). Optional `limit` (1–200, default 20).
- Added `src/version.ts` as the single source of truth for the server
  version. The McpServer constructor now imports `SERVER_VERSION` from
  there instead of hard-coding a literal — fixes the v0.3.0/v0.3.1
  drift between `package.json` and the registered MCP server version.
  The `version_consistency` doctor check verifies the two stay aligned.
- No changes to envelope wire format, JSONL audit format, on-disk
  storage layout, or `create_handoff` behavior.

## v0.3.1

- **Documentation only.** No code, schema, or behavior changes.
- Added `docs/ROOKIE_MODE.md` — workflow guide describing how to drive
  RelayOS from a single primary Claude session, with Codex picking up
  its own assignments via `read_latest_handoff`.
- Added `examples/claude-subagents/relayos-orchestrator.md` — drop-in
  [Claude Code subagent](https://docs.claude.com/en/docs/claude-code/sub-agents)
  that translates "ask Codex to ..." style requests into
  `create_quick_handoff` calls, record-only by default.
- Added `examples/codex/AGENTS.md` — drop-in Codex-side instruction
  file that has Codex call `read_latest_handoff` at session start and
  treat the returned envelope as binding (allowed_files,
  forbidden_files, constraints, expected_output).
- Added a Rookie Mode entry-point note near the top of the README.
- No runtime orchestration, no background runner, no UI/TUI, no
  doctor/inspect_config tools shipped in this release. All examples
  use MCP tools that already existed in v0.3.0.

## v0.3.0

- Added MCP tool `create_quick_handoff` — one-shot handoff creation from a
  sentence. Pass `target_agent` + `task` (plus optional `mode`,
  `allowed_files`, `forbidden_files`, `constraints`) and the server picks a
  built-in template for you. Defaults: `codex` → `patch`, `claude` → `plan`.
  Modes: `patch`, `review`, `test`, `plan`. Unmapped combinations
  (`claude+patch`, `claude+test`) throw a clear `quick_handoff_no_template`
  error pointing the caller at `create_handoff_from_template` (project
  template) or `create_handoff` (full envelope).
- Implementation is a thin wrapper over `create_handoff_from_template` —
  no new envelope fields, no new audit events, no new template logic.
  Tags inherited from the chosen template (e.g. `template:codex-patch`)
  flow through unchanged.
- No changes to envelope wire format, JSONL audit format, on-disk storage
  layout, `create_handoff` behavior, or built-in templates.

## v0.2.1

- Added MCP tool `read_latest_handoff` — return the most recent open handoff
  (status `recorded` or `spawning`), optionally filtered by `assigned_to`.
  Returns `{ envelope: null, events: [] }` when nothing matches, so callers
  can poll safely without try/catch. Designed for Codex (or Claude) to
  discover "what was I just asked to do?" without needing the handoff id.
- Rewrote MCP tool descriptions for `list_templates`,
  `create_handoff_from_template`, `create_handoff`, and `validate_handoff`
  to make selection from natural-language requests more reliable. Each
  description now leads with the kind of user phrasing that should trigger
  it, then what the tool does, then when to prefer an alternative.
- No changes to envelope wire format, JSONL audit format, on-disk storage
  layout, or `create_handoff` behavior.

## v0.2.0

- Added MCP tool `list_templates` — list available handoff templates
  (built-in + project config), optionally filtered by `target_agent`.
- Added MCP tool `create_handoff_from_template` — create a structured
  handoff from a template name plus a short natural-language task. The
  server fills `model`, `effort`, `execution_mode`, `allowed_files`,
  `forbidden_files`, `constraints`, and `expected_output` from the
  resolved template; the caller supplies only the task string and any
  per-call overrides.
- Added six built-in templates: `codex-patch`, `codex-review`,
  `codex-test`, `codex-plan`, `claude-review`, `claude-plan`. Patch
  handoffs default to Codex (`codex-patch`).
- Added optional project config at `.relayos/config.json` (with upward
  directory search and `RELAYOS_CONFIG` env override) that can extend
  built-in templates or add new ones.
- `create_handoff` is unchanged and remains the low-level API. Envelope
  wire format, JSONL audit format, and on-disk storage layout are
  unchanged from v0.1.x.
- No slash commands are shipped or installed. If you want one, write a
  Markdown wrapper in `~/.claude/commands/` yourself.
- **Scope:** Core uses static, reliability-first template defaults. No
  cost-aware routing, budgets, success-rate tracking, automatic
  downgrade, or automatic escalation in this release — those are
  future Pro features. No built-in template defaults to `max` or
  `xhigh`; Core never auto-selects `max`. `max`/`xhigh` are valid
  caller overrides only.

## v0.1.1

- Fixed `validate_handoff` MCP input handling by accepting `{ "payload": ... }`, so clients can no longer strip invalid candidate fields before validation. Legacy direct input remains accepted.
- Changed `expected_output` to accept `string | string[]` and normalize to `string[]` internally. Legacy v0.1.0 envelopes with a string value still load without migration.
