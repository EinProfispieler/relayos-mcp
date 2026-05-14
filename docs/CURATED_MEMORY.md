# RelayOS Curated Memory and Context Packs (Design Note)

Status: Future design direction only. This document does not claim current implementation support.

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

## Possible Future Commands and MCP Tools

Potential future command/tool surface (directional only):

- `relayos overseer context-pack`
- `relayos overseer summarize-session`
- `relayos overseer decisions`
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

## Privacy and Safety Defaults

Future curated memory should follow conservative defaults:

- default local-first
- avoid storing secrets
- redact sensitive values when captured
- prefer summaries over raw logs
- raw transcripts are not automatically shared

Any transcript retention should be explicit, bounded, and reviewable.

## Product Tier Direction

Direction by tier:

- Core: notes/recent/manual summaries
- Pro: context packs and multi-project memory
- Business: shared team memory and approval evidence
- Enterprise: searchable audit memory, retention policy, compliance export

## Non-Goals For Now

This design note does not propose current implementation of:

- raw chat sync
- vector database implementation
- cloud memory service
- provider-backed summarizer implementation
- automatic cross-app context injection

## Summary

RelayOS memory direction should prioritize compact, policy-aware continuity artifacts over full transcript sharing. The near-term value is better handoff quality, lower context noise, and stronger auditability while keeping operator control.
