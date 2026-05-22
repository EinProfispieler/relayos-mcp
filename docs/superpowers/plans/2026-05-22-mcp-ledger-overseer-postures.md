# MCP Ledger + Overseer Takeover Modes — Plan

**Status:** Durable record of the plan produced by completion of handoff `h_01KS6J7QVPEKE7RH12DQ25GH4Z`.
**Origin:** That handoff was authored Claude→Claude, `auto_spawn:true`, hit a usage-limit on first run, and was replayed read-only via a Plan subagent on 2026-05-22. The original envelope is **intentionally left at `status: failed`** for historical fidelity; the replay is recorded as a handoff-result entry (`run_id h_01KS6J7QVPEKE7RH12DQ25GH4Z`, `status: completed`) plus a `manual_completion` audit event.
**Approved scope for execution:** **P3-A only** (surface cleanup). P3-B / P3-C / P3-D / P3-E are deferred and require a separate approval before any code is written for them.
**Out of scope (binding):** Task 15 repair-layer CLI/MCP; daemons; autonomous executors; cross-project state; hard security sandboxes; cloud sync.

---

## Executive summary

RelayOS today is a local-first audit, handoff, and curated-context layer. It does NOT own Claude/Codex execution except when the user explicitly invokes `overseer execute-handoff` / `plan-execute-task` or calls MCP `create_handoff(auto_spawn:true)`. The Run Ledger (Tasks 1–14, shipped 2026-05-20 plan) and the P2 auto-record gate (`isRunLedgerAutoRecordEnabled`, default OFF, opt-in only — shipped 2026-05-22 on `feat/run-ledger-p2-fresh` commit `9f0ef70`) are the existing scaffolding for "what changed during a run."

The current `overseer` CLI exposes 33 subcommands; only 23 are documented after the post-P2 doc trim. The `init-context` CLI writes lowercase stub filenames (`project_brief.md`, `current.md`, …) that the canonical UPPERCASE readers (`overseer.ts:262, 680, 768`; `conversation.ts:833`) ignore — while a second set of readers (`cli.ts:1036, 1211, 2680`) historically read the lowercase ones. The 2026-05-22 lowercase-reader cleanup commit (working tree, uncommitted) made `status` / `recent` / `brief` read UPPERCASE first with lowercase fallback. The remaining drift is in `init-context` itself and in 10 undocumented subcommands.

This plan introduces an explicit, multi-mode "Overseer session" concept layered on top of that existing surface, with three precisely separated postures (`assist`, `managed`, `full-auto`), a four-step ledger policy (`off | relayos-work-only | session-tasks | managed-all`), a permission matrix that respects what MCP can and cannot actually enforce (RelayOS cannot constrain Claude/Codex unless it owns the spawn path), and a small CLI/MCP surface for entering, observing, and exiting the session. **Defaults stay OFF; connection ≠ consent.** The migration is phased so existing commands keep working while new ones land.

---

## Terminology and state machine

### Definitions

- **assist** — RelayOS observes and advises. It exposes read-only MCP context tools, recommends commands, and may produce curated notes/decisions/handoffs the user can *manually* execute. It MUST NOT auto-spawn anything, MUST NOT toggle Run Ledger auto-record, MUST NOT write any append-only event beyond notes/decisions/handoff_results the user explicitly invokes. (Mirrors `read_overseer_capabilities` allowed-by-default set.)
- **managed** — RelayOS dispatches handoffs *with per-action user approval*. Each `create_handoff(auto_spawn:true)`, `overseer execute-handoff`, or `overseer plan-execute-task` becomes a prompt-and-confirm in the active client (Claude/Codex CLI/Codex App). Run Ledger auto-record is enabled for the duration of the session. Forbidden-actions list is still enforced. Cross-project work is blocked.
- **full-auto / 托管** — RelayOS dispatches handoffs under a persistent pre-approval bound by an explicit permission matrix and stop conditions, derived from `docs/SCOPED_ROOKIE_RUNTIME.md`. The session has a scope contract (goal / allowed actions / forbidden actions / stop condition). High-risk actions (commit, push, tag, release, schema, runtime activation, provider/API config) still require explicit per-action approval — full-auto is *not* a security sandbox. This is the only mode in which the Run Ledger may be set to `managed-all`.

### State diagram

```
[no session]
   │
   │ overseer enter --posture assist
   ▼
[assist] ──── overseer exit ──────────────► [no session]
   │
   │ overseer escalate --posture managed --scope <contract>
   ▼
[managed] ──── overseer exit ─────────────► [no session]
   │
   │ overseer escalate --posture full-auto --scope <contract> --approve-persistent
   ▼
[full-auto] ── overseer exit / stop-condition ► [no session]
```

Escalation is one-way per command call. Demotion is allowed (`overseer enter --posture assist` while in `managed` returns to `assist`); each demotion writes a decision record and flushes any persistent approvals.

### Session lifecycle

- **enter**: writes a `SessionRecord` to `.relayos/overseer/session/active.json` (gitignored). Required fields: `posture`, `started_at`, `client_hint` (claude-cli|codex-cli|codex-app|mcp), `cwd`, `scope_contract?` (required for `managed` and `full-auto`).
- **persist**: a session is a process-independent file. Any client (CLI or MCP) that calls `read_overseer_session` sees the same posture.
- **resume**: re-entering returns the existing session unless `--force-new`.
- **exit**: moves `active.json` → `archive/<ts>.json`. A timeline note + decision record are auto-written.

---

## Recommended surfaces

### CLI

| Command | Status | Notes |
|---|---|---|
| `overseer status` | keep (public) | extend with `posture`, `session.id` (P3-C) |
| `overseer context` / `handshake` / `recent` / `brief` / `start` / `mode` / `env` / `doctor` / `summary` / `context-pack` / `run-preflight` / `wake-instructions` | keep (public) | unchanged |
| `overseer note` / `next` / `decision` / `decisions` / `branch` / `progress` | keep (public) | `decision` was undocumented; **P3-A** adds it to OVERSEER.md |
| `overseer handoff-result(s)` | keep (public) | unchanged |
| `overseer init --project --dry-run` | keep (public) | unchanged |
| `overseer init-context` | **fix-then-deprecate** | currently writes lowercase filenames (`overseer.ts:1500`). **P3-A:** change `STUB_CONTENTS` keys to UPPERCASE (`PROJECT_BRIEF.md`, `CURRENT_STATE.md`, `RELEASE_POLICY.md`, `FORBIDDEN_ACTIONS.md`, `PRODUCT_DIRECTION.md`) and add a one-shot legacy-rename step that renames `project_brief.md` → `PROJECT_BRIEF.md` etc. on init-context call when the canonical file is absent and the legacy file exists. **P3-A.5:** also update lowercase fallback in readers to be removable after one minor version. |
| `overseer activate-runtime` / `runtime-check` | keep (public) | unchanged |
| `overseer capabilities` | **document** (P3-A) | mirrors `read_overseer_capabilities` |
| `overseer memory-index` | **document** (P3-A) | mirrors `read_overseer_memory_index` |
| `overseer role-profile` | **document** (P3-A) | mirrors `read_overseer_role_profile` |
| `overseer execute-handoff` | keep but **mark "managed-only" in P3-C** | now refuses to run when posture is `assist`; suggests `overseer escalate --posture managed` |
| `overseer plan-extract` / `plan-answer` / `plan-task-handoff` / `plan-execute-task` / `plan-report` | **document under a `plan` namespace** (P3-A) | undocumented today |
| `overseer run start|current|resume|compact|complete|abandon|list` | keep (public) | unchanged; doc that `start` is the consent event for `relayos-work-only` ledger policy |
| `overseer run register-workspace|list-workspaces|update-workspace` | keep (public) | unchanged |
| `overseer enter [--posture …] [--scope …] [--client …]` | **new (P3-C)** | creates `session/active.json` |
| `overseer exit [--keep-session-id]` | **new (P3-C)** | archives `active.json`; writes auto note+decision |
| `overseer session [--json]` | **new (P3-B)** | reads `active.json`; no side effects |
| `overseer escalate --posture <m\|f> [--scope …] [--approve-persistent]` | **new (P3-C)** | upgrades posture; full-auto requires `--approve-persistent` and a scope contract |
| `overseer posture [--json]` | **new (P3-B)** | thin alias for `session` |
| `overseer policy ledger <off\|relayos-work-only\|session-tasks\|managed-all>` | **new (P3-C)** | persists into `session/active.json#ledger_policy`; refuses managed-all unless posture is full-auto |
| `overseer permissions show [--json]` | **new (P3-B)** | prints the resolved permission matrix |

### MCP

| Tool / Prompt / Resource | Purpose | Phase | Notes |
|---|---|---|---|
| `enter_overseer_session` | New tool. Required `posture`; `managed`/`full-auto` also require `scope_contract`. Returns resolved permission matrix. | P3-C | Explicit consent event. Does NOT enable Run Ledger auto-record unless `enable_ledger_policy: "session-tasks"` (or higher). |
| `read_overseer_session` | New read-only tool. Returns active session + posture + ledger policy + permission matrix snapshot. | P3-B | Safe to poll; mirrors `overseer session --json`. |
| `exit_overseer_session` | New tool. Archives session, writes auto note+decision, resets ledger policy to off. | P3-C | Idempotent. |
| `escalate_overseer_session` | New tool. Full-auto escalation requires `approve_persistent:true` + `scope_contract`. | P3-C | Refused if no active session. |
| `read_overseer_permissions` | New read-only tool. Returns permission matrix for current posture+scope. | P3-B | Stateless function over session+capabilities. |
| `set_run_ledger_policy` | New tool. Persists ledger policy into session. Refuses `managed-all` unless posture is `full-auto`. | P3-C | The `RELAYOS_RUN_LEDGER_AUTO_RECORD` env var stays supported; session-set policy wins when both present. |
| MCP prompt `overseer/bootstrap` | New optional MCP prompt for Claude (prompts capability). | P3-D | Codex CLI has no prompt support; surface the same text via `read_overseer_bootstrap_prompt` tool (already exists). |
| MCP prompt `overseer/enter-managed` | New prompt offering a one-shot template to enter `managed` posture. | P3-D | Claude only. |
| All existing `read_overseer_*` / `write_overseer_*` / `*_run_event` / `*_task_ledger` / `*_execution_workspace` | unchanged | — | Posture-aware gating added on writes (see Permission matrix). Read tools remain available in all postures. |
| `create_handoff` / `create_handoff_from_template` / `create_quick_handoff` with `auto_spawn:true` | **gated by posture** | P3-C | `assist`: refused (`auto_spawn_requires_managed_or_full_auto`). `managed`: allowed; per-call still subject to user approval via the MCP client's permission prompt. `full-auto`: allowed without per-call prompt only for non-high-risk actions in the permission matrix. |

**Enforcement boundary (binding):** RelayOS only enforces gates on paths RelayOS owns — its own CLI subcommands and MCP tool calls. It cannot prevent the user from invoking Claude or Codex outside MCP. Posture is a *suggestion to clients and an enforcement boundary on RelayOS-owned spawning paths*, not a global lock.

### RTUI

Add an **Overseer** tab to `src/rtui/screens/SettingsPanel.tsx` (phase P3-D):

| Field | Type | Default | Validation | Notes |
|---|---|---|---|---|
| Default posture on `overseer enter` | enum (assist\|managed\|full-auto) | `assist` | enum | Pure preference, never the active posture |
| Allow auto-spawn from MCP `create_handoff` | bool | `false` | — | Project-level toggle. When false, MCP `auto_spawn:true` is refused in `managed` too unless overridden per-call. |
| Default Run Ledger policy on enter | enum (off\|relayos-work-only\|session-tasks\|managed-all) | `off` | enum + posture compatibility | UI greys out managed-all unless default posture is full-auto |
| Persist Run Ledger env opt-in | bool | `false` | — | Writes `RELAYOS_RUN_LEDGER_AUTO_RECORD=1` to project's `.env.local` hint file. Never modifies user shell profile. |
| Forbidden actions (project-scoped) | text list | from `FORBIDDEN_ACTIONS.md` | trim/dedup | Read-only view if file exists; otherwise editable seed |
| Confirmation required for commit/push/tag/release | bool | `true` | — | Cannot be turned off via the panel even in full-auto |

Persistence schema (additive — `RelayConfig` stays strict): extend `RelayConfig.overseer` in `src/schema.ts:391` with optional `session_defaults`:

```ts
session_defaults: z.object({
  default_posture: z.enum(["assist","managed","full-auto"]).optional(),
  default_ledger_policy: z.enum(["off","relayos-work-only","session-tasks","managed-all"]).optional(),
  allow_mcp_auto_spawn: z.boolean().optional(),
  require_confirmation_for_release_actions: z.boolean().optional(),
}).strict().optional()
```

Active session state stays *outside* the config — in `.relayos/overseer/session/active.json`.

---

## Permission matrix

(Defaults; everything is overridable by `FORBIDDEN_ACTIONS.md`, which always wins.)

| Action | assist | managed | full-auto |
|---|---|---|---|
| Read overseer context / state files | yes | yes | yes |
| `overseer note` / `decision` / `progress` writes | yes (user-invoked) | yes | yes |
| `write_overseer_note` / `write_overseer_decision` MCP | yes | yes | yes |
| `write_handoff_result` MCP | yes | yes | yes |
| `create_handoff(auto_spawn:false)` | yes | yes | yes |
| `create_handoff(auto_spawn:true)` | **no** | yes (per-call approval) | yes (matrix-gated) |
| `overseer execute-handoff` | **no** | yes (per-call approval) | yes (matrix-gated) |
| `overseer plan-execute-task` | **no** | yes (per-call approval) | yes (matrix-gated) |
| `write_run_event` / `update_task_ledger` (during execute-handoff path) | n/a | yes (via auto-record) | yes (via auto-record) |
| `register_execution_workspace` | yes (user-invoked) | yes | yes (auto on spawn) |
| Filesystem writes inside cwd | yes (user-invoked CLI/tool) | yes | yes for allowed-action set |
| Filesystem writes *outside* cwd | no | no | no (still requires per-call approval) |
| Spawn provider/agent process | no | yes (per-call) | yes (matrix-gated) |
| `git commit` | no | **per-call approval** | **per-call approval** |
| `git push` | no | **per-call approval** | **per-call approval** |
| `git tag` | no | **forbidden by default** | **forbidden by default** |
| `git merge` | no | **per-call approval** | **per-call approval** |
| Create GitHub release | no | **forbidden by default** | **forbidden by default** |
| Schema/migration changes | no | **per-call approval** | **per-call approval** |
| Runtime workspace activation | no | per-call (dry-run free) | per-call |
| Provider/API config changes | no | per-call | per-call |
| Cross-project (non-cwd) operations | no | no | no |

"Per-call approval" inside `full-auto` means RelayOS still surfaces a prompt to the user via whichever client owns the spawn — there is no persistent grant for these specific actions.

---

## Ledger policy matrix

| Policy | Active when | Files written | MCP tools available (writes) |
|---|---|---|---|
| `off` | default in all postures | none under `runs/` | none of the `write_run_event` family writes anything (returns `{ skipped: "ledger_off" }`) |
| `relayos-work-only` | opted in for self-development of RelayOS; default for `assist` when user runs `overseer run start` inside the RelayOS repo | only `runs/<id>/run.json`, `task_ledger.jsonl`, `source_index.jsonl`, `execution_workspaces.jsonl` for runs the user explicitly started | `write_run_event`, `update_task_ledger`, `register_execution_workspace` succeed; `maybeAutoRecordHandoffExecution` still default OFF |
| `session-tasks` | opt-in via `overseer policy ledger session-tasks` inside a `managed` session; or `--record-run-ledger` flag; or `RELAYOS_RUN_LEDGER_AUTO_RECORD=1` env | adds source touches + execution workspace records on every handoff dispatched through RelayOS-owned paths | full Run Ledger MCP write set; `maybeAutoRecordHandoffExecution` returns `recorded` outcomes |
| `managed-all` | only valid inside `full-auto` posture | everything above plus per-tool continuation packets (`compact` may be auto-called on token budget) | full set |

The Run Ledger gate stays in `src/run_ledger.ts:isRunLedgerAutoRecordEnabled`. Session policy is layered on by extending that helper to read `session/active.json#ledger_policy` as a third signal (with the same priority as `--record-run-ledger`). The env var and the per-call flag remain untouched for backward compatibility.

---

## Migration / deprecation

| Today | New surface | Migration |
|---|---|---|
| `RELAYOS_RUN_LEDGER_AUTO_RECORD=1` env | session ledger policy = `session-tasks` | env keeps working; doc points at `overseer policy ledger` as the preferred path |
| `--record-run-ledger` flag | per-call only (kept) | unchanged |
| `overseer execute-handoff` (any posture today) | `managed` or `full-auto` posture required | P3-C: print warning when run with no active session; P3-E: refuse with exit 1 + pointer to `overseer enter --posture managed` |
| `overseer init-context` writes lowercase | UPPERCASE stubs + auto-rename legacy | **P3-A**: ship the fix |
| Lowercase reads at `cli.ts:1036,1211,2680` | UPPERCASE primary + lowercase fallback | **P3-A.1 ALREADY SHIPPED** (working tree this batch, uncommitted): `readOverseerCanonicalText` wrapper. P3-E (later): drop lowercase fallback |
| Undocumented `capabilities`/`memory-index`/`role-profile`/`decision`/`decisions`/`plan-*` | documented (public) | **P3-A**: doc-only |

### Compatibility windows
- One minor version with both casings supported for context files.
- Two minor versions of warning before `execute-handoff` requires a session.
- Env var honored indefinitely; UI mode just sets it on the session.

---

## Phased implementation

### P3-A — surface cleanup (no behavior change beyond fixing the casing bug) — **APPROVED FOR EXECUTION**

**Scope cap (binding):** OVERSEER.md drift, init-context casing bug, lowercase reader cleanup, usage/doc consistency, tests. **NO posture/session machinery.**

**Sub-batches:**

- **P3-A.1 — lowercase reader cleanup** ✅ **ALREADY DONE in this working tree** (uncommitted). `src/overseer.ts` gained `readOverseerCanonicalText`; `src/cli.ts` `runOverseerStatus` / `runOverseerRecent` / `runOverseerBrief` switched to UPPERCASE-first + lowercase fallback; `tests/overseer_canonical_text.test.ts` locks both directions (case-sensitive FS test auto-skips on macOS APFS).
- **P3-A.2 — init-context casing fix** — change `STUB_CONTENTS` in `src/overseer.ts:1500` to write UPPERCASE filenames (`PROJECT_BRIEF.md`, `CURRENT_STATE.md`, `RELEASE_POLICY.md`, `FORBIDDEN_ACTIONS.md`, `PRODUCT_DIRECTION.md`, plus `branches/active/*.md` and `planned/*.md` unchanged). Add a one-shot rename step that, when init-context runs, detects legacy lowercase files and renames them to canonical before writing new stubs. Test: a sandbox with pre-existing lowercase files ends up with canonical UPPERCASE after `init-context`.
- **P3-A.3 — document the undocumented subcommands** — add OVERSEER.md sections (one paragraph each) for: `capabilities`, `memory-index`, `role-profile`, `decision`, `decisions`, `execute-handoff`, `plan-extract`, `plan-answer`, `plan-task-handoff`, `plan-execute-task`, `plan-report`.
- **P3-A.4 — usage/doc consistency** — verify the dispatcher usage string at `src/cli.ts:3324` lists every subcommand documented in OVERSEER.md and vice versa.
- **P3-A.5 — tests** — beyond the existing `overseer_canonical_text.test.ts`, add a test that asserts `init-context` writes UPPERCASE files and renames legacy ones.

**Files likely touched:**
- `docs/OVERSEER.md` (P3-A.3, P3-A.4)
- `src/overseer.ts` (P3-A.2)
- `src/cli.ts` (P3-A.4 — usage string only)
- `tests/overseer_canonical_text.test.ts` (P3-A.5 — extend with init-context cases, OR new test file)

**Acceptance criteria:**
- `overseer doctor` reports `context_complete: true` after `overseer init-context` on a fresh dir.
- `read_overseer_handshake` finds `PROJECT_BRIEF.md`.
- No command crashes on legacy lowercase layouts.
- OVERSEER.md lists every dispatched subcommand from `runOverseer` (cli.ts:3281).
- Typecheck + vitest + RTUI all green.

### P3-B — session primitives (read-only first) — DEFERRED, AWAITING APPROVAL

Introduce `SessionRecord`, `Posture`, `LedgerPolicy`, `PermissionMatrix`. Add CLI `overseer session` / `overseer posture` / `overseer permissions show`. Add MCP `read_overseer_session`, `read_overseer_permissions`. No writes, no posture enforcement on RelayOS-owned paths yet — read-only first.

### P3-C — session writes + posture enforcement — DEFERRED

`enter` / `exit` / `escalate` exist and *do* gate `execute-handoff`, `plan-execute-task`, MCP `create_handoff(auto_spawn:true)`. Default behavior unchanged for users who never call `enter`.

### P3-D — RTUI Overseer tab — DEFERRED

Surface preferences from P3-C in `SettingsPanel`. Adds `session_defaults` to `RelayConfig.overseer`.

### P3-E — docs + deprecation warnings — DEFERRED

Close the loop; start the deprecation clock for legacy paths.

---

## Open questions (require user decision before P3-B begins)

1. Should `enter_overseer_session` MCP tool require an opaque session token in subsequent write calls (defence-in-depth) or is "active session exists" enough? **Recommend:** rely on the file for v1; add a token later if multi-client races appear.
2. When a `managed` session is active but the user invokes an MCP write tool from a different cwd than the session's `cwd`, do we (a) refuse, (b) write to the active session's cwd, or (c) write to the caller's cwd with a warning? **Recommend:** (a) strict refuse with a clear error message.
3. Should the `assist` posture be implicit (≡ "no session") or explicit (must `overseer enter --posture assist`)? **Recommend:** implicit. Users only `enter` to escalate.
4. Codex CLI has no MCP prompts. Replicate `overseer/bootstrap` and `overseer/enter-managed` text inside `read_overseer_bootstrap_prompt` / `read_overseer_handshake` outputs so Codex sees them too? **Recommend:** yes — single source in tool output; MCP prompts are thin wrappers.
5. `RELAYOS_RUN_LEDGER_AUTO_RECORD=1` and an active session whose `ledger_policy=off` — does env win or session win? **Recommend:** session wins (session is a deliberate consent event scoped to a workspace; env stays as a process-wide override for CI).
6. Should `overseer exit` automatically run `overseer run complete` if a Run is active? **Recommend:** no — independent lifecycles; emit a note that one is still open.

---

## Out of scope / non-goals

- **Task 15 — repair-layer CLI/MCP tools.** Referenced only as future work.
- Any background daemon, queue runner, or autonomous executor (ROADMAP §9 non-goals stand).
- Provider routing, multi-project profiles, server-side state, team-shared policies.
- Hard security sandbox guarantees. Postures are policy + consent; they are not a sandbox.
- Cloud sync or shared session state. `session/active.json` is local-only and gitignored.
- Modifying the Claude/Codex client binaries; MCP can only suggest+enforce on the paths RelayOS owns.

---

## Critical files for P3-A implementation

- `/Users/randy/GID/src/cli.ts:3281` — `runOverseer` dispatch (source of truth for the subcommand inventory)
- `/Users/randy/GID/src/cli.ts:3324` — usage string (must match OVERSEER.md command list after P3-A.4)
- `/Users/randy/GID/src/overseer.ts:1500-1510` — `STUB_CONTENTS` (the lowercase-filename bug source; rewritten in P3-A.2)
- `/Users/randy/GID/src/overseer.ts:1512` — `initContextFiles` (add legacy-rename step in P3-A.2)
- `/Users/randy/GID/src/overseer.ts:646-695` — `readOverseerTextFile` + `readOverseerCanonicalText` (the lowercase-fallback wrapper landed in P3-A.1)
- `/Users/randy/GID/docs/OVERSEER.md` — command list + Storage section
