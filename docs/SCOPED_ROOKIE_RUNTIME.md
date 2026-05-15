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

## Environment Failure and Recovery Policy (Future)

This section is future-design only and does not imply current runner support.

For scoped runtime runs, errors like `EPERM`, `proxyconnect`, `127.0.0.1:7890`, npm registry failures, and GitHub registry failures should default to environment failures unless evidence indicates implementation fault.

Future runtime direction:

- retry the same scoped task in a fresh process first
- allow up to 3 total attempts for the same scoped task
- record `failure_type` as:
  - `environment_network_proxy_tun`
  - `environment_sandbox_permission`

If retries fail, status should move to `needs_manual_environment_approval` before final environment blocking, with a clear recovery plan and explicit user approval request.

Approved recovery actions may include:

- retrying in a normal Terminal
- rerunning with isolated npm cache
- rerunning the same scoped command outside the failed sandbox

Runtime should record approved action details and result evidence.

Future status notes that may appear in this flow:

- `environment_retrying`
- `needs_manual_environment_approval`
- `environment_recovery_running`
- `blocked_by_environment`

Recovery boundaries:

- do not automatically change system proxy/TUN settings
- do not modify shell profiles or global npm/git/proxy config without explicit approval
- do not upload secrets/logs
- do not disable security tools
- do not broaden scope during recovery

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
- automatic proxy/TUN/system network reconfiguration
- security sandbox guarantees/claims

## Relationship To Product Tiers

Future tier direction alignment:

- Core keeps manual handoff
- Pro may add scoped local runtime
- Business/Enterprise may add approval queues, policy inheritance, and audit dashboards

## Summary

Scoped Rookie Mode direction should preserve operator control, explicit boundaries, and auditable outcomes. The runtime is envisioned as bounded workflow orchestration, not autonomous unlimited agency.

## Related Future Contract

For future completion detection and structured result evidence (without implying current runner/daemon support), see:

- [HANDOFF_RUN_CONTRACT.md](./HANDOFF_RUN_CONTRACT.md)
