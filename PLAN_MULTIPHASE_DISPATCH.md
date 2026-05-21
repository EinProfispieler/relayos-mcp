# Spec: Multi-Phase Plan Dispatch (Plan → Q&A → Execute → Fix)

Status: spec for review. Builds on the shipped AI-driven dispatch
(`PLAN_OVERSEER_DISPATCH.md`). Target branch `production`.

## Goal

For **new projects and new features**, the overseer first dispatches a
read-only **plan job** to Codex/Claude. The plan agent (free to use its own
planning/brainstorming skills) returns a structured plan: a **todo list of
pre-routed handoffs** plus **open questions** plus a **reporting rule**. The
user answers the questions in `relays`. The overseer then executes the todo
list item by item — debug, fix, and tweak each task that fails — and ends with
an aggregated project report.

Trivial, well-specified changes still dispatch directly (the shipped behavior);
the plan phase only engages for project/feature-scale work.

## The `<PROJECT_PLAN>` block

The plan handoff instructs the agent to end its output with one block, parsed
deterministically by RelayOS (parallel to the existing `ACTION_INTENT`
convention in `src/conversation.ts`):

```
PROJECT_PLAN
goal: <one-line goal>
questions:
  - <open question for the user>
  - <...>
tasks:
  - id: t1
    title: <short title>
    target: codex | claude
    model: <model id>
    effort: low | medium | high | xhigh | max
    mode: patch | review | test | plan
    description: <what this task does>
    depends_on: []
  - id: t2
    depends_on: [t1]
    ...
reporting: <rule each task follows to report back — e.g. write_handoff_result
            with status, summary, tests run, blockers>
END_PROJECT_PLAN
```

Every task carries its full dispatch data (target AI, model, effort, mode,
description) so the overseer needs no further routing decision at execute time.

## Schema

New zod schema in `src/schema.ts`:
- `ProjectPlanTask` — `{ id, title, target, model, effort, mode, description,
  depends_on, status, handoff_id?, result? }` where `status` ∈
  `pending | running | completed | failed | blocked`.
- `ProjectPlan` — `{ plan_id, created_at, goal, questions[], answers[], tasks[],
  reporting, source_handoff_id, status }`.

Persisted to `.relayos/overseer/plans/<plan_id>.json` (gitignored, alongside the
existing overseer state).

## Phases

### Phase 1 — Plan generation

1. **Trigger.** Extend `ActionIntentType` with `project_plan`. The
   `buildScopedProviderInput` prompt (`src/conversation.ts`) tells the AI: when
   the user asks for a new project or a sizable new feature, emit
   `intent_type: project_plan`.
2. **Plan handoff.** `runChatTurn` (`src/chat.ts`): on `project_plan` intent,
   build a read-only handoff — `execution_mode:"plan"`, `target` from the AI
   (default `claude`) — whose `task_description` instructs the agent to plan the
   work, use its planning skills freely, and end with a `<PROJECT_PLAN>` block.
   Emit the turn sentinel with `handoff_kind:"plan"`.
3. **Execute + extract.** The RTUI auto-executes the plan handoff (read-only =
   safe). New CLI command `relayos overseer plan-extract <handoff_id>`: reads
   the handoff's captured stdout, parses `<PROJECT_PLAN>`, persists a
   `ProjectPlan`, prints it on an `@@RELAYOS_PLAN@@` sentinel line.
4. **Render.** RTUI shows the goal, the todo list (each task with a status
   marker), and the numbered questions. Status → `awaiting_answers` (new
   `Status` value). New scrollback item `plan_summary`.

### Phase 2 — Q&A and execution

5. **Collect answers.** The user answers questions as ordinary chat turns; the
   RTUI appends them to the plan's `answers[]` (CLI: `plan-answer <plan_id>`).
6. **Proceed.** New `/proceed` slash command. The overseer walks `tasks[]` in
   `depends_on` order; tasks with no unmet dependency and no overlapping
   `allowed_files` may run **in parallel**, the rest serialize. Each task
   creates a handoff from its pre-routed fields (no re-routing) and executes it
   — honoring step/build mode and the release/approval gates already in place.
7. The RTUI todo list updates each task's status live
   (`pending→running→completed/failed`).

### Phase 3 — Debug / fix / tweak loop

8. When a task handoff exits non-zero, the overseer dispatches a **fix handoff**:
   same target, `mode` unchanged, `task_description` augmented with the failed
   task's stderr/stdout tail and the failure summary. Bounded to **2 fix
   attempts** per task.
9. Still failing after retries → task `status:"blocked"`, surfaced to the user
   with the captured error; remaining independent tasks continue.

### Phase 4 — Project report

10. After the todo list drains, `relayos overseer plan-report <plan_id>`
    aggregates every task's `write_handoff_result` into one report: per-task
    status, the provider/model that ran, tests, blockers. Rendered in the RTUI
    and written to `.relayos/overseer/plans/<plan_id>.report.md`.

## Files

| File | Change |
|---|---|
| `src/schema.ts` | `ProjectPlanTask`, `ProjectPlan`; `project_plan` intent type |
| `src/conversation.ts` | prompt: when/how to emit `<PROJECT_PLAN>` |
| `src/project_plan.ts` (new) | `<PROJECT_PLAN>` parser, plan persistence helpers |
| `src/chat.ts` | `project_plan` intent → plan handoff in `runChatTurn` |
| `src/cli.ts` | `plan-extract`, `plan-answer`, `plan-report` subcommands |
| `src/rtui/state/types.ts` + `store.ts` | `ProjectPlan` state, `awaiting_answers`, `plan_summary` item, todo-list actions |
| `src/rtui/Shell.tsx` | plan-handoff flow, `/proceed`, todo-list rendering |
| `src/rtui/commands/registry.ts` | `/proceed` command |
| `src/rtui/screens/` | todo-list panel component |

## Tests

- `tests/project_plan.test.ts` — `<PROJECT_PLAN>` parser: well-formed, missing
  fields, malformed (silently ignored like `ACTION_INTENT`).
- `tests/chat_turn.test.ts` — `project_plan` intent → plan handoff with
  `execution_mode:"plan"`.
- `tests/cli_overseer_plan.test.ts` — `plan-extract` / `plan-answer` /
  `plan-report` round-trip.
- RTUI store/Shell tests — `awaiting_answers`, todo-list status transitions,
  `/proceed`.

## Recommended sequencing

Ship **Phase 1 alone first** (plan generation + todo list + questions rendered,
no execution). It is independently useful and verifiable. Phases 2–4 follow as
separate PRs. Each phase keeps all existing tests green.

## Provider capability matrix

`relays` is an IDE whose brain is the overseer; each AI is a specialist. The
overseer's routing prompt encodes this matrix — it still chooses per task, but
within these bounds:

| Provider | Role | When chosen |
|---|---|---|
| Codex | Implementation, patching, refactors, tests | Primary for coding |
| Claude | Planning, review, analysis, explanation, docs | Primary for planning/review |
| Gemini | Legal / law / copyright / compliance review only | If the `gemini_compliance` setting is on; never coding |
| GLM | Low-priority fallback / minor system tweaks | Only when Codex/Claude are absent — never preferred over them |

Provider pool rules:
- The configured `providers[]` is one ordered list. Provider #1 is the overseer
  **brain**; on failure the brain fails over to #2, #3 … (already implemented in
  `conversation.ts`).
- The same pool is the **dispatch pool** — only providers present in settings
  (key entered / logged in) are eligible task targets.
- New setting `gemini_compliance` (boolean, default `true`): when on, the
  overseer may route legal/copyright/compliance review tasks to Gemini; when
  off, no such dispatch occurs.
- Dispatch executable resolution: a provider entry's `command`/`args`/`api_base`
  define how it launches. GLM dispatches as the `claude` CLI against GLM's
  endpoint (works today via config); Gemini-CLI needs a small render adapter
  (`src/render/gemini.ts`).

## Same-file work — sequential pipeline

When two AIs must touch the same file, tasks are **serialized**: AI-A edits, then
AI-B works on A's output (e.g. Codex implements → Claude refines). RelayOS never
3-way-merges two AIs' diffs. A second AI may run in parallel only in `review`
mode (it comments, it does not edit). Conflict = overlapping `allowed_files`.

## Out of scope

- Live interactive skills inside the spawned agent (the TTY-passthrough path).
- True parallel editing of one file with automated diff merge.
