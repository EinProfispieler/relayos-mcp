# Plan: AI-Driven Provider Dispatch (Overseer Butler)

Status: ready to execute. Target branch `production`.

## Problem

The overseer pipeline ignores the AI's provider choice and the configured
`providers[]`. Every actionable task is hardcoded to **Codex + patch**; reviews
and planning never become executable handoffs; there is no failover.

Evidence in current code:

- `src/chat.ts:88` `buildHandoffInputFromPending` hardcodes
  `source_agent:"claude"`, `target_agent:"codex"`, `execution_mode:"patch"`.
- `src/action_dispatch.ts` `buildActionProposal` hardcodes `target:"codex"` for
  `implementation`, and emits `review_request` (not `create_handoff`) for
  `review` — so reviews never produce a handoff.
- `src/conversation.ts:667` `buildScopedProviderInput` asks the AI for
  `target: codex|claude|overseer` but gives **no capability guidance** and does
  not tell it which providers are actually configured.
- `src/cli.ts` `runOverseerExecuteHandoff` has no `backup_providers` failover.

The AI's chosen `target` *does* survive as far as `planRouteFromActionIntent`
(`ai_planner.ts:90`) — it is dropped at `buildActionProposal` and
`buildHandoffInputFromPending`. So the fix is mostly "stop discarding it" plus
"teach the AI to choose well" plus "fail over on launch failure".

## Scope

In scope: codex ↔ claude AI-driven dispatch + failover passthrough.
Out of scope (follow-up): multi-phase chaining (plan→implement→review), GLM as a
`target_agent` (the `AgentName` enum is `codex|claude` only).

## Steps

### Step 1 — Capability briefing in the AI prompt (`src/conversation.ts`)

`buildScopedProviderInput(projectRoot, userMessage, providers?)`:
- New optional `providers` arg: `Array<{ name: string; model: string }>`.
- Before the `ACTION_INTENT` block, insert a `PROVIDER ROUTING GUIDANCE` section:
  - codex → implementation, patching, refactors, writing/running tests.
  - claude → review, planning, analysis, explanation, documentation.
  - "Pick `target` by task fit. Only pick from configured providers below."
  - List the configured providers (name + model) when `providers` is non-empty.
- Call site `runLocalCommandProvider` (line ~316): derive `providers` from
  `cfg`/loaded config and pass it through. If config providers aren't reachable
  there, pass `undefined` — guidance still renders without the explicit list.

### Step 2 — Honor `plan.target` in `buildActionProposal` (`src/action_dispatch.ts`)

- `implementation`: `target` = `plan.target` when it is `"codex"` or `"claude"`,
  else `"codex"`. Keep `action:"create_handoff"`, `mode: plan.mode`.
- `review`: change `action` to `"create_handoff"` (was `review_request`),
  `target` = `plan.target` when `codex|claude`, else `"claude"`,
  `mode:"review"`.
- `release_control` / `approval_required` gating unchanged.
- `planning` stays `local_plan`; `unknown` unchanged.

### Step 3 — Provider-aware handoff input (`src/chat.ts`)

Rewrite `buildHandoffInputFromPending` + `buildHandoffInputFromPendingWithProfiles`:
- `target_agent`: from `actionProposal.target` (`codex|claude`), default `codex`.
- `source_agent`: `"claude"` (the overseer dispatcher) — unchanged.
- `execution_mode`: map `actionProposal.mode` → `ExecutionMode`
  (`patch|review|plan|test`), default `patch`.
- `model`/`effort`: resolve from the chosen provider. Add
  `resolveProviderProfile(cfg, target)` reading `overseer.providers[]` by
  `name`, falling back to `model_profiles` defaults. Widen `effort` typing to
  the full `Effort` enum (`low|medium|high|xhigh|max`).
- `expected_output`: `patch/test` → `["Patch applied","Tests pass"]`;
  `review/plan` → `["Findings/plan summarized; no files modified"]`.
- Update `runChatTurn` (chat.ts ~868) and the interactive path (chat.ts ~595)
  to pass the resolved config through.

### Step 4 — `backup_providers` failover in `execute-handoff` (`src/cli.ts`)

In `runOverseerExecuteHandoff`:
- Extract the single attempt (`detectCli` → `runTarget`) into a local helper.
- Build an ordered attempt list: the envelope's `target_agent` first, then each
  distinct `codex|claude` provider name resolved from
  `overseer.backup_providers` → `overseer.providers[]`.
- On `detectCli` not-found OR `exit_code !== 0`: re-render `launch_command` for
  the next provider (`renderCodexTarget`/`renderClaudeTarget` on a
  `target_agent`-swapped envelope copy) and retry. Max 3 attempts total.
- Audit-log every attempt; final envelope records the provider that ran.
- All-fail → status `failed`, exit 1 (current behavior).

## Files

| File | Change |
|---|---|
| `src/conversation.ts` | capability briefing + configured-provider list in prompt |
| `src/action_dispatch.ts` | honor `plan.target`; review → `create_handoff` |
| `src/chat.ts` | provider-aware `buildHandoffInputFromPending*`; `resolveProviderProfile` |
| `src/cli.ts` | `backup_providers` failover loop in `execute-handoff` |

## Tests

- `tests/action_dispatch.test.ts` — implementation honors `claude` target;
  review now yields `create_handoff` with `mode:"review"`.
- `tests/chat_turn.test.ts` — claude-target task → envelope `target_agent:"claude"`,
  `execution_mode:"review"`; codex task unchanged.
- `tests/cli_overseer_execute_handoff.test.ts` — failover: primary CLI missing →
  retries backup; both missing → fail.
- New `tests/conversation_routing.test.ts` — `buildScopedProviderInput` includes
  guidance and the configured-provider list.
- All existing vitest + `npm run test:rtui` stay green.

## Verification

1. `npm run typecheck` clean.
2. `npm test` + `npm run test:rtui` green.
3. `npm run build` + `npm run build:rtui`.
4. CLI: `node dist/cli.js chat-turn "review the auth module"` →
   `@@RELAYOS_TURN@@` line with `target_agent:"claude"`.
   `node dist/cli.js chat-turn "implement a hello function"` → `target_agent:"codex"`.
5. Failover smoke test in `cli_overseer_execute_handoff.test.ts`.
