# Provider Routing Plan (Future Pro/Business/Enterprise Direction)

This document captures future product direction for provider/carrier routing in RelayOS commercial tiers. It is a planning note only and does not represent current implementation.

## 1. Core position

RelayOS Core remains:

- local-first
- provider-independent
- human-supervised
- an audit/control layer, not autonomous orchestration

Core should not require third-party provider routing to function.

## 2. Future tier direction

Potential tier behavior:

- **Pro:** user-selected third-party route APIs for model-backed overseer review.
- **Business/Enterprise:** admin-managed provider/carrier allowlists and governance controls.

Routing must use only carriers/providers explicitly selected by the operator or organization.

## 3. Explicit selection and fallback policy

Future routing principles:

- No implicit fallback to unapproved carriers.
- Fallback behavior must be explicit, policy-driven, and operator-approved.
- Route/provider choice should be auditable and explainable per review action.

## 4. Example future carrier/provider options (non-binding)

Examples of possible future integrations (not current support):

- VVEAI-compatible route API
- operator-selected backup route endpoint
- OpenRouter-like route APIs
- direct OpenAI / Gemini / Vertex provider APIs where appropriate

Placeholder field names only (non-secret):

- `primary_route_url`
- `backup_route_url`
- `api_key`
- `provider_extra_token`

No real credential values should appear in docs, configs, commits, logs, or reports.

## 5. Overseer profile routing bindings (future)

Each overseer profile may eventually bind:

- overseer type
- provider/carrier
- model
- route endpoint
- budget/rate policy
- allowed task classes
- audit logging requirements

Example overseer profiles:

- coder overseer
- project overseer
- release overseer
- compliance/copyright overseer
- department audit overseer
- enterprise governance overseer

## 6. Decision semantics and limits

Provider-routed overseer outputs are advisory audit evidence only.

They are not:

- legal advice
- compliance certification
- security enforcement

Human approval remains required for decisions and execution.

## 7. Future implementation guardrails

Before any routing implementation, future work should include:

- secret redaction
- credential storage outside git
- provider allowlist enforcement
- route health checks
- explicit fallback policy
- audit logs capturing chosen provider/model/route
- report-layer protections against secret leakage

## 8. Non-goals for now

Not in scope now:

- provider integration implementation
- API key storage implementation
- network calls
- billing/account system
- automatic fallback
- enterprise server implementation

## 9. Summary

This plan preserves future provider-routing direction for commercial editions while keeping RelayOS Core local-first and provider-independent today. No current implementation exists.
