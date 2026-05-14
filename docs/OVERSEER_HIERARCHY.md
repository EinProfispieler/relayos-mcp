# Overseer Hierarchy (Future Design Note)

This document preserves a future product direction for RelayOS: a possible multi-level overseer hierarchy for broader governance. It is a design note only, not an implementation plan for the current Core release.

## 1. Current Core assumption

RelayOS Core currently assumes:

- local-first operation
- a single repository scope
- a single local project overseer
- human-supervised workflows
- an audit/control layer for AI-assisted development, not a hard security sandbox and not an autonomous OS

This keeps Core deterministic and practical for solo/local development.

## 2. Future hierarchy concept

A future hierarchy may include distinct overseer layers:

1. Task/session overseer
2. Project overseer
3. Team/department overseer
4. Enterprise audit/governance overseer

These layers would allow policy and workflow controls to match organizational complexity while preserving clear operator responsibility.

## 3. Why teams may need different overseers

Different domains often require different guardrails and approvals. For example:

- frontend work may prioritize UX review and release cadence
- backend work may require stricter data/API safety checks
- infra work may require deployment and change-window controls
- docs work may follow lighter release constraints
- release work may require cross-functional signoff

A single flat policy can be too coarse for mixed teams.

## 4. Policy inheritance model (future)

A future policy stack may follow this order:

1. enterprise policy
2. department policy
3. project policy
4. task/session policy

Key principle: lower layers may be stricter, but must not bypass higher-layer requirements.

## 5. Session handshake connection

Future handshake flows may expose a merged policy snapshot derived from the active hierarchy.

Current behavior should stay simple:

- handshake is local-project scoped
- handshake is read-only
- handshake does not imply central orchestration, daemon behavior, or remote governance

## 6. Product tiers and direction

Potential product direction:

- Core: single local project overseer
- Pro: multiple local project/profile overseers
- Team: shared project policies and approval workflows
- Enterprise: department/global audit overseers, governance, dashboards, compliance export

This describes tier direction only. It does not imply current implementation.

## 7. Explicit non-goals for now

Not in scope now:

- enterprise server implementation
- department overseer implementation
- central audit dashboard
- policy inheritance engine
- automatic agent orchestration
- any security sandbox claim

## 8. Summary

RelayOS Core remains local-first and single-overseer by design. Multi-level overseer hierarchy is preserved here as future direction so migration planning can reference a stable concept later, without expanding current implementation scope.

## 9. Future direction: higher-level API-backed advisory overseers

In future tiers, RelayOS may allow higher-level overseer review to be delegated to stronger/latest external model APIs as advisory layers above project/task overseers.

Examples:

- A high-capability model (for example GPT-5.5 or the latest capable OpenAI model) may be used for architecture, release, security-risk, and cross-agent governance review.
- A long-context model (for example Gemini or equivalent) may be used for legal/compliance/copyright/policy/documentation consistency and external-facing risk review.

Guardrails for this direction:

- Human approval remains required for decisions and actions.
- Model outputs are advisory audit evidence only, not legal advice, compliance certification, or security enforcement.
- Provider/model choice should be configurable in future implementations.
- Local-first Core must not depend on these APIs.
- No current implementation exists in RelayOS Core.

## 10. Future direction: Team/Enterprise admin assignment of overseer profiles

Future Team/Enterprise editions may expose a backend/admin panel, web UI, or app UI for governance configuration.

Possible direction:

- Admins assign each employee, coder, project, or department an overseer type/profile.
- Admins assign which agent/model/provider backs that overseer profile.

Example overseer profiles:

- coder overseer
- project overseer
- release overseer
- compliance/copyright overseer
- department audit overseer
- enterprise governance overseer

This is configuration/governance direction only.

- Human approval and audit trails remain required.
- Local-first Core must not depend on this panel.
- No current implementation exists.
