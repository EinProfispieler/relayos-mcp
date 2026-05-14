# RelayOS Release Policy

Status: Active project policy for release decisions.

## Purpose

Keep RelayOS releases meaningful, auditable, and user-focused.

## Core Rules

1. Do not create standalone GitHub releases for documentation-only commits.
2. Documentation-only changes should be committed and pushed, then bundled into the next functional release.
3. Create releases for user-visible CLI/MCP/workflow behavior changes, important bug fixes, or bundled milestones.
4. Patch releases (`vX.Y.Z`) are for fixes and small behavior updates.
5. Minor releases (`vX.Y.0`) are for new CLI commands, MCP tools, or workflow capabilities.
6. Roadmap/future-design documentation updates do not justify releases by themselves.
7. Local gitignored helper changes do not justify releases by themselves.
8. Never reuse, rewrite, or republish an existing published tag without explicit approval.

## Practical Guidance

- Docs-only PR/commit: merge normally, no standalone release.
- Mixed change set (code + docs): release may proceed if user-visible behavior changed.
- If uncertain, defer release and bundle with the next functional CLI/MCP/workflow increment.

## Non-Goals

- This policy does not delete or rewrite historical tags/releases automatically.
- This policy does not change runtime behavior.
