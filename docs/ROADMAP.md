# RelayOS Roadmap (Draft)

Status: Forward-looking product roadmap. Future items in this document are not currently shipped unless explicitly marked as current Core.

## Purpose

Preserve RelayOS product direction before daily overseer workflows move into MCP-connected Codex/Claude sessions.

## 1) Current Core Foundation

RelayOS Core today is a local-first control, audit, and handoff layer.

Current MCP session loop already available:

- `read_overseer_handshake`
- `read_overseer_recent`
- `write_overseer_note`

Codex and Claude can connect through RelayOS MCP and share local overseer state through these local interfaces.

Core remains:

- human-supervised
- non-daemon
- not a hard security sandbox

## 2) Curated Memory Instead Of Raw Full Chat History

RelayOS should not share raw full chat transcripts across apps by default.

RelayOS should prefer curated continuity artifacts:

- categorized summaries
- timeline notes
- decision records
- task evidence
- context packs
- indexed/retrievable session summaries

Future possible commands/tools (directional, not current support):

- `context-pack`
- decision record workflows
- memory search
- session summarizer

Why this direction:

- stronger privacy by default
- better auditability
- selective reuse across clients
- reduced context pollution and prompt drift

## 3) Advanced Rookie Mode

Advanced Rookie Mode direction: a human-supervised agent routing and handoff runtime.

Possible explicit scopes:

- feature
- branch
- PR
- build
- release
- incident

RelayOS may recommend or assign Claude, Codex, GPT, Gemini, or other approved providers/models depending on scope policy.

High-risk actions should require explicit human approval:

- commit
- push
- tag
- release
- deletion
- schema changes
- runtime activation
- provider/API configuration

## 4) Scoped Overseer Runtime

Future runtime direction is not a global always-on AI daemon.

Each scoped run should declare at minimum:

- scope
- goal
- allowed actions
- forbidden actions
- stop condition
- audit evidence outputs

This keeps runtime behavior bounded and reviewable, rather than autonomous/unlimited.

## 5) Multi-Client Design

RelayOS should not duplicate Claude/Codex app functionality.

Claude, Codex, ChatGPT, Gemini, and local models remain clients/providers.

RelayOS role in a multi-client system:

- session protocol
- handoff contracts
- curated state
- timeline
- policy gates
- approval boundaries
- audit evidence

## 6) Model-Backed Higher Overseers

Future oversight workflows may use model-backed higher overseers for specialized review tasks.

Examples:

- GPT/latest OpenAI models: architecture review, release review, security-risk review, cross-agent governance review
- Gemini/long-context models: legal/compliance/copyright/policy consistency review

These outputs should be treated as advisory audit evidence only.

They are not:

- legal advice
- compliance certification
- security enforcement

Provider/carrier choice must be explicit and configurable.

No implicit fallback to unapproved providers.

## 7) Product Tiers (Direction)

Core:

- manual handoff
- MCP handshake/recent/note
- basic MCP status/cleanup/doctor (future direction)

Pro:

- scoped Rookie Mode runtime
- multi-project profiles
- context packs
- user-selected route APIs

Business:

- shared policies
- approval queues
- admin provider allowlists
- team overseer assignment

Enterprise:

- department/global governance overseers
- policy inheritance
- audit dashboards
- compliance export
- managed agent registry
- private deployment/server control plane

## 8) Near-Term Recommended Direction

Near-term sequencing:

1. Stop adding new MCP tools unless a real gap appears.
2. Prioritize curated context-pack and memory summarization direction.
3. Prepare MCP-client daily workflow patterns for Codex/Claude.
4. Keep runtime/provider/team features in design mode until Core usage is stable.

## 9) Non-Goals For Current Core

Current Core non-goals:

- no daemon
- no autonomous agent runner
- no automatic unapproved Claude/Codex switching
- no raw full chat sync
- no security sandbox claim
- no provider integration implementation
- no enterprise server implementation

## Summary

Roadmap direction is to keep Core simple and reliable while layering curated memory and scoped, human-supervised runtime capabilities in later tiers. Future features remain design targets until explicitly implemented and documented as shipped.
