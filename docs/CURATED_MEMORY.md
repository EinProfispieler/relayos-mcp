# RelayOS Curated Memory and Context Packs (Design Note)

Status: Mixed. Some curated-memory primitives are implemented in Core; other items remain future design direction.

## Purpose

Expand the roadmap direction that RelayOS should not share raw full chat history across apps, and should instead provide curated, searchable, auditable continuity for Codex/Claude/MCP clients.

## Problem

Raw full chat history is often:

- too long for practical reuse
- noisy for task-focused handoff
- private/sensitive by default
- difficult to audit consistently

Large transcript replay can degrade focus, leak unnecessary details, and increase policy risk.

## Principle

RelayOS should preserve curated continuity, not raw chat sync.

Curated continuity should keep only what operators and collaborators need to continue work safely and efficiently.

RelayOS should not over-optimize away useful local context only to minimize disk usage. Curated memory should be practical for real project continuity and audit.

## Memory Layers (Conceptual)

A future curated memory model may include:

- session handshake
- current state
- next action
- forbidden actions
- timeline notes
- decision records
- task summaries
- task evidence
- context packs
- archived raw transcript references only when explicitly retained

This structure emphasizes retrievability and audit over full-log replay.

## Current Core Commands

Currently shipped local-first curated-memory commands:

- `relayos overseer context-pack`
- `relayos overseer summary`
- `relayos overseer decision add <text>`
- `relayos overseer decisions [--json] [--limit <1-20>]`

Current shipped curated-memory primitives include:

- context packs with bounded `recent_notes` and `recent_decisions`
- deterministic read-only session summaries (`relayos overseer summary`)
- decision records (write/read via CLI and MCP)
- local timeline notes and compact recent-state readback

Current MCP curated-memory tools:

- `read_overseer_summary`
- `read_overseer_context_pack`
- `read_overseer_decisions`
- `write_overseer_decision`
- `read_overseer_recent`
- `write_overseer_note`

## Possible Future Commands and MCP Tools

Potential future command/tool surface (directional only):

- `relayos overseer summarize-session`
- `read_overseer_context_pack`
- `write_decision_record`
- `search_overseer_memory`

These names are placeholders for design planning, not shipped interfaces.

## Context Pack Suggested Sections

A context pack could include stable sections such as:

- `project_summary`
- `current_state`
- `next_action`
- `recent_decisions`
- `recent_notes`
- `forbidden_actions`
- `model_policy`
- `recommended_prompt`
- `evidence_links`

Goal: allow a new MCP-connected session to recover intent and constraints without replaying full transcript history.

## Local Storage Posture (Future)

RelayOS can prioritize useful local evidence retention over aggressive size minimization.

- modern developer machines commonly have fast SSD capacity that can hold substantial curated state
- Linux/macOS environments may also rely on memory-backed caches or swap during large local context preparation
- because most AI inference is remote, local resources are mainly consumed by preparation, indexing, summarization, and audit workflows
- curated context packs and structured evidence should be preferred over raw unbounded prompt injection

Disk usage should still be observable and manageable through clear local accounting and operator controls.

## Privacy and Safety Defaults

Future curated memory should follow conservative defaults:

- default local-first
- avoid storing secrets
- redact sensitive values when captured
- prefer summaries over raw logs
- raw transcripts are not automatically shared

Any transcript retention should be explicit, bounded, and reviewable.

## Private Backup and Versioning Direction (Future)

Future RelayOS may support opt-in private backup/versioning for curated overseer state.

Possible targets:

- private GitHub repository
- private git remote
- self-hosted git server

Candidate content:

- markdown state files
- curated session summaries
- decision records
- context packs
- timeline summaries
- audit evidence indexes

Intended benefits:

- backup and disaster recovery
- versioned conversation/workflow state
- stronger markdown state management across long-running projects

Safety boundaries for this direction:

- no default cloud sync
- no automatic upload of raw full chat transcripts
- no secrets in backup
- require redaction and ignore rules
- private backup must be explicit and operator-approved

## Product Tier Direction

Direction by tier:

- Core: notes/recent/manual summaries
- Pro: context packs and multi-project memory
- Business: shared team memory and approval evidence
- Enterprise: searchable audit memory, retention policy, compliance export

Business/Enterprise direction may extend backup governance with retention policy, access controls, audit exports, and admin-managed backup policies.

## Non-Goals For Now

This design note does not propose current implementation of:

- raw chat sync
- vector database implementation
- cloud memory service
- provider-backed summarizer implementation
- automatic cross-app context injection

## Summary

RelayOS memory direction should prioritize compact, policy-aware continuity artifacts over full transcript sharing. The near-term value is better handoff quality, lower context noise, and stronger auditability while keeping operator control.
