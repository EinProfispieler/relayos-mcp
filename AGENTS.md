# AGENTS.md — Working with RelayOS

> **MANDATORY — read this first, every time.**
> Before doing ANY work on RelayOS (`relays` / the `GID` repo), you MUST:
> 1. Read this file (`AGENTS.md`) in full.
> 2. Read `SAMPLE_GUIDE.md`, and consult `sample2/` and `samplecode/` to
>    understand how relays is used as a real business project.
> 3. Only then plan or change code.
> This is not optional. Do it at the start of every relays task.

## What RelayOS is

A local-first control layer for AI-assisted development. The user talks to one
endpoint — `bin/relays` (the RTUI chat) — which acts as a **project butler**
(the *overseer*): it discusses, researches, plans, dispatches the best-fit AI
provider/model/effort, monitors jobs, and reports back. Codex and Claude are the
two first-party providers; work is passed between them via **handoff envelopes**.

## Reference material — check before working

| Resource | Purpose |
|---|---|
| `SAMPLE_GUIDE.md` | How `sample2/` and `samplecode/` are structured and run |
| `sample2/` | Full runnable Bun project — the executable baseline for testing relays as a real business project |
| `samplecode/` | Source-only snapshot — reference/comparison only, not runnable as-is |
| `docs/MODEL_STRATEGY.md` | Role-vs-provider design, the "model-role matrix" direction |
| `docs/ROADMAP.md` | Product direction: Advanced Rookie Mode, scoped runtime, tiers |
| `docs/SCOPED_ROOKIE_RUNTIME.md` | Future overseer routing/runtime design |
| `docs/OVERSEER.md` | Overseer CLI/MCP surface |

To exercise relays against a real project, use `sample2/` as the working
repo (`cd sample2 && npm install --legacy-peer-deps`).

## Architecture map

| Layer | Files |
|---|---|
| RTUI chat (bun bundle → `dist/rtui.js`) | `src/rtui/` |
| CLI / MCP engine (node → `dist/cli.js`) | `src/cli.ts`, `src/index.ts` |
| Chat pipeline + single-turn `runChatTurn` | `src/chat.ts` |
| Intent → route planning | `src/ai_planner.ts`, `src/action_dispatch.ts` |
| Provider model/effort resolution | `src/model_profiles.ts` |
| Handoff envelope schema | `src/schema.ts` |
| Handoff create/execute tools | `src/tools/`, `src/cli.ts` (`execute-handoff`) |
| Provider launch command rendering | `src/render/{codex,claude,shared}.ts` |
| Provider process spawning | `src/spawn/index.ts` |
| Config load/save | `src/config.ts`, `src/rtui/screens/settings/configIO.ts` |

The RTUI (bun) never imports node engine code directly — it shells out to
`dist/cli.js` via `src/rtui/commands/runner.ts`. Keep that boundary.

## Build & verify

```sh
npm run typecheck     # tsc --noEmit
npm test              # vitest (node engine)
npm run test:rtui     # bun test (RTUI)
npm run build         # dist/cli.js (tsup)
npm run build:rtui    # dist/rtui.js (bun)
```

Always run `typecheck` + both test suites before claiming work complete.

## Git / PR conventions

- Remote: `EinProfispieler/relayos`; working branch: `production`.
- Commit style: `type(scope): summary` (e.g. `fix(rtui/settings): ...`).
- Tag stable points for rollback (e.g. `v0.6.0-settings-ui`).
- Never commit/push/tag without explicit user approval.

## AI-driven dispatch (shipped 2026-05-19)

The overseer routes each job to the best-fit provider:

- The AI picks `target` (codex vs claude) guided by capability briefing in the
  `ACTION_INTENT` prompt (`src/conversation.ts`).
- `buildActionProposal` / `buildHandoffInputFromPending` honor that choice;
  model/effort resolve from the chosen provider's `overseer.providers[]` entry.
- `execute-handoff` fails over to `backup_providers` (codex ↔ claude) when the
  primary CLI is missing or exits non-zero.

See `PLAN_OVERSEER_DISPATCH.md` for the design.

## Known gaps (as of 2026-05-19)

- No multi-phase job chaining yet (plan → implement → review in one turn).
- GLM cannot be a `target_agent` — the `AgentName` enum is `codex|claude` only.
