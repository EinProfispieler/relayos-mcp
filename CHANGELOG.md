# Changelog

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
