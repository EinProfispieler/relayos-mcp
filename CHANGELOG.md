# Changelog

## v0.1.1

- Fixed `validate_handoff` MCP input handling by accepting `{ "payload": ... }`, so clients can no longer strip invalid candidate fields before validation. Legacy direct input remains accepted.
- Changed `expected_output` to accept `string | string[]` and normalize to `string[]` internally. Legacy v0.1.0 envelopes with a string value still load without migration.
