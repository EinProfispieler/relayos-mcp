# Rookie Mode Future Direction (Draft)

Status: Future direction only. This document does not describe currently shipped runtime behavior.

## Purpose

Preserve RelayOS product direction before daily overseer operations move into MCP client workflows.

## Product Positioning

RelayOS should remain a local-first control, audit, memory, policy, and handoff layer connected through MCP.

RelayOS should not duplicate Claude/Codex app functionality. It should coordinate and preserve workflow state around those clients, not replace them.

## Continuity Principles

RelayOS should not share raw full chat history across apps.

Instead, RelayOS should support curated cross-client continuity through structured artifacts such as:

- categorized summaries
- timeline notes
- decision records
- task evidence
- context packs
- indexed/retrievable session summaries

These artifacts should be designed for portability, auditability, and selective reuse across approved MCP-connected clients.

## Advanced Rookie Mode Direction

Advanced Rookie Mode should evolve into a human-supervised agent routing and handoff runtime.

Possible explicit scopes for runtime operations:

- feature
- branch
- PR
- build
- release
- incident

Routing may recommend or assign Claude, Codex, GPT, Gemini, or other approved providers, subject to local policy and operator control.

## Human Approval and Risk Gating

High-risk actions should remain policy-gated and require explicit human approval, including:

- commit
- push
- tag
- release
- deletion
- schema changes
- runtime activation
- provider/API configuration

No future runtime direction in this document should be interpreted as autonomous authority to bypass approval gates.

## Core Boundary (Current)

Current RelayOS Core remains:

- local-first
- human-supervised
- non-daemon
- not a security sandbox
- not an autonomous agent runner

## Packaging of Future Tiers

Future direction can be described as a staged product model:

- Core: manual handoff + MCP handshake/recent/note
- Pro: scoped Rookie Mode runtime, multi-project profiles, context packs
- Business/Enterprise: approval queues, policy inheritance, audit dashboards, provider allowlists, managed agent registry

## Non-Goals of This Draft

This document does not implement or claim current support for:

- daemon/runtime execution
- agent routing implementation
- memory index backend changes
- provider integration changes
- schema changes

It is a documentation-only preservation note for future planning.
