# Changelog

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
