# Scoped Rookie Mode Runtime (Future Design Note)

Status: Future design direction only. This document does not claim current implementation support.

## Purpose

Describe how advanced Rookie Mode may evolve into a human-supervised agent routing and handoff runtime without becoming an unbounded autonomous daemon.

## Current Core (Shipped)

Current RelayOS Core remains:

- manual handoff
- MCP handshake/recent/note session loop
- human-supervised operation

Core is intentionally conservative and does not imply autonomous runtime control.

## Future Concept

Advanced Rookie Mode may become a scoped, human-supervised agent routing and handoff runtime.

The runtime concept is bounded by explicit scope, policy, and approval checkpoints.

## Possible Scope Types

- feature
- branch
- PR
- build
- release
- incident

## Required Scope Contract

Each runtime scope should define at minimum:

- goal
- repo/project
- branch/worktree
- allowed actions
- forbidden actions
- target agents/models
- model policy
- stop condition
- approval gates
- audit evidence
- rollback/recovery notes

No scope should execute without a complete contract.

## Agent Routing Direction (Future)

Example specialization model (directional):

- Claude for planning, review, and documentation
- Codex for repository edits and test execution
- GPT/latest model for architecture, release, and security judgment
- Gemini/long-context model for compliance, copyright, and policy consistency review
- approved providers only

Provider/model routing should be explicit and configurable, not implicit.

## Actions That May Be Automated

Low-risk bounded actions that may be automated within scope:

- read
- plan
- summarize
- create handoff
- run tests
- collect diff
- write notes
- recommend commit

## Actions Requiring Explicit Human Approval

High-risk actions should require explicit approval before execution:

- commit
- push
- tag
- release
- deletion
- schema changes
- runtime activation
- provider/API configuration
- cross-project operations

## Non-Goals For Now

This design note does not propose current implementation of:

- always-on autonomous AI daemon behavior
- unbounded task loop execution
- automatic release execution
- unapproved provider fallback
- security sandbox guarantees/claims

## Relationship To Product Tiers

Future tier direction alignment:

- Core keeps manual handoff
- Pro may add scoped local runtime
- Business/Enterprise may add approval queues, policy inheritance, and audit dashboards

## Summary

Scoped Rookie Mode direction should preserve operator control, explicit boundaries, and auditable outcomes. The runtime is envisioned as bounded workflow orchestration, not autonomous unlimited agency.
