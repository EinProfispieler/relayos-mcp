# RTUI — RelayOS Terminal UI design

- **Date:** 2026-05-17
- **Status:** Approved (brainstorm complete; awaiting implementation plan)
- **Owner:** Randy (EinProfispieler)
- **Audience:** Codex / Claude agents implementing the work

## 0. Goal in one line

Replace the readline-based `chat` mode in `bin/relays` with a React + Ink TUI (`src/rtui/`), built on Bun, structured so AI agents can maintain it with minimal human help.

## 1. Decisions locked in during brainstorming

| # | Decision | Notes |
|---|---|---|
| 1 | UI library: **React + Ink** | matches sample2 (leaked Claude Code source) |
| 2 | Scope: **chat mode only** | `relays` and `relays chat` enter RTUI; `banner`, `doctor`, `report`, `run`, `settings`, `overseer` still flow through `dist/cli.js` |
| 3 | Code location: **`src/rtui/`** inside the main `relayos-mcp` package | no monorepo split |
| 4 | Runtime: **Bun ≥1.3** (required for both dev and ship) | end users must install Bun |
| 5 | Sample2 reuse: **reference only**, with copy-and-tidy fallback for tricky bits; MIT npm deps used as-is | see §10 for license note |
| 6 | v1 scope: **TUI foundation first**, RelayOS functions ported in later phases | see §7 migration plan |
| 7 | Shell architecture: **single REPL screen + transient overlays** | mirrors sample2's `REPL.tsx` |

## 2. Architecture overview

The RTUI shell is one persistent Ink screen with three slots and a stack of transient overlays:

```
┌────────────────────────────── <Static> scrollback ─────────────────┐
│  (rendered once per line, never re-rendered — exits in terminal    │
│   history when user scrolls)                                       │
│                                                                    │
│   ❯ improve docs in README.md                                      │
│   ⠋ planning route…                                                │
│   ✓ proposed handoff codex/patch · /approve to send                │
└────────────────────────────────────────────────────────────────────┘
┌────────────────────────────── live region ─────────────────────────┐
│  (re-renders every tick — spinners, streaming AI tokens, progress) │
└────────────────────────────────────────────────────────────────────┘
┌────────────────────────────── input + status ──────────────────────┐
│  ❯ /st█                                                            │
│  gpt-5.3-codex medium · ~/GID · production · Ready · ctx 100%      │
└────────────────────────────────────────────────────────────────────┘

         ╭──── overlay layer (only when active) ──────╮
         │  Slash palette · Settings wizard · Task    │
         │  list · Confirm dialogs · Help             │
         ╰────────────────────────────────────────────╯
```

Three principles, in priority order:

1. **Scrollback uses Ink `<Static>`** so completed lines never re-render. This is the single most important rule. Terminal history stays intact when the user scrolls up; rendering stays smooth even with thousands of past lines.
2. **Overlays are absolute-positioned boxes** rendered on top of the live region. When an overlay opens, REPL input is paused, but scrollback above remains visible (think: VS Code command palette).
3. **One `useReducer` is the single source of truth.** Components subscribe via `RTUIContext`. No prop drilling, no scattered local state for anything domain-related.

## 3. Module layout

```
src/rtui/
├── index.tsx               # entry: bin/relays → here. Parses argv, mounts <App>.
├── App.tsx                 # top-level: <RTUIProvider><Shell/></RTUIProvider>
├── Shell.tsx               # scrollback + live + input rows; overlay portal
├── AGENTS.md               # first-thing-to-read for any agent (§6)
│
├── state/
│   ├── store.ts            # useReducer + action types (single source of truth)
│   ├── context.tsx         # RTUIContext + useRTUI() hook
│   └── selectors.ts        # memoized reads (currentTask, pendingProposal, runtimeView)
│
├── screens/
│   ├── ScrollbackArea.tsx  # <Static> log; renders history items by type
│   ├── LiveRegion.tsx      # spinners, streaming tokens, progress lines
│   ├── InputRow.tsx        # prompt + multiline editor (lift sample2 useTextInput)
│   └── StatusLine.tsx      # model/effort/dir/branch/pending/ctx — uses chat_ui_framework helpers
│
├── overlays/
│   ├── OverlayHost.tsx     # stack manager: push/pop, esc-to-close, focus capture
│   ├── SlashPalette.tsx    # filtered command list
│   ├── HelpOverlay.tsx     # /help content
│   ├── ConfirmDialog.tsx   # generic yes/no
│   └── (later) SettingsWizard.tsx, TaskList.tsx, StatusPanel.tsx
│
├── input/
│   ├── useKeybindings.ts   # central dispatcher; per-overlay scope
│   ├── slashRouter.ts      # maps "/cmd args" → action creators
│   └── textInput.ts        # adapted from sample2's useTextInput (copy-and-tidy)
│
├── runtime/
│   ├── bridge.ts           # facade over src/overseer, src/conversation, etc.
│   ├── stdoutTransport.ts  # raw write helpers (for non-TTY / pipe mode)
│   └── ticker.ts           # frame-rate gate for live region (avoid render thrash)
│
├── theme/
│   └── colors.ts           # re-exports chat_ui_framework color helpers, adds Ink Text variants
│
├── __fixtures__/
│   └── fakeOverseer.ts     # deterministic fixtures for bridge tests
│
└── (tests live next to source: store.test.ts, SlashPalette.test.tsx, ...)
```

**Two boundary rules:**

- **`runtime/bridge.ts` is the only file allowed to import from** `src/overseer.ts`, `src/conversation.ts`, `src/settings.ts`, `src/ai_planner.ts`, `src/action_dispatch.ts`, `src/tools/*`. RTUI components talk to RelayOS through this single facade. When new `bin/relays` functions get ported, they become methods on `bridge.ts` rather than scattered imports across the component tree.
- **`src/chat_ui_framework.ts` is reused.** Its color helpers, `pendingStateLabel`, `renderRuntimeLine`, and `renderWelcome` are useful inside Ink `<Text>` nodes. The slash overlay controller in there is *replaced* by `overlays/SlashPalette.tsx`.

## 4. State and data flow

One reducer, one store, dispatched actions. No mutable refs for domain state.

### 4.1 Store shape

```ts
type RTUIState = {
  session: { id: string; startedAt: string; messageCount: number };
  runtime: {
    projectDir: string;
    branch: string;
    model: string;
    effort: "low" | "medium" | "high";
    isGitRepo: boolean;
  };
  scrollback: ScrollbackItem[];        // append-only; rendered by <Static>
  live: { spinner: string | null; streaming: string | null; progress: number | null };
  input: { value: string; cursor: number; history: string[] };
  overlays: Overlay[];                 // stack; top = focused
  conversation: ConversationMessage[]; // mirror of src/conversation messages
  pendingProposal: PendingActionProposal | null;
  currentTaskId: string | null;
  status: "idle" | "thinking" | "awaiting_approval" | "executing";
};
```

### 4.2 ScrollbackItem variants

Each renders as its own row, picked by a `match` on the `type` discriminator:

- `user_input` — the user's typed line.
- `assistant_text` — completed AI reply (final, not streaming).
- `system_note` — "✓ proposed handoff…", "✗ blocked: needs approval".
- `error` — red row with diagnostic.
- `divider` — section break.

### 4.3 Actions

This list is the API the bridge calls into:

```
INPUT_CHANGED, INPUT_SUBMITTED, HISTORY_PREV, HISTORY_NEXT
OVERLAY_PUSH, OVERLAY_POP
SCROLLBACK_APPEND
LIVE_SET_SPINNER, LIVE_SET_STREAM, LIVE_CLEAR
STATUS_SET, RUNTIME_UPDATED
CONVERSATION_APPEND
PROPOSAL_PENDING, PROPOSAL_CLEARED
TASK_SET_CURRENT
```

### 4.4 Data flow for a typical turn

```
user types text → InputRow → dispatch(INPUT_SUBMITTED)
   ↓
slashRouter inspects: starts with "/"?
   ├── yes → dispatch overlay push or run command via bridge
   └── no  → dispatch SCROLLBACK_APPEND(user_input)
             dispatch STATUS_SET("thinking")
             bridge.routeConversation(text) → returns AsyncIterable<ChunkEvent>
                ↓ for each chunk:
                  dispatch LIVE_SET_STREAM(partial)
                ↓ on done:
                  dispatch SCROLLBACK_APPEND(assistant_text)
                  if actionIntent found:
                    bridge.proposeAction(...) → dispatch PROPOSAL_PENDING
                  dispatch LIVE_CLEAR, STATUS_SET("idle")
```

### 4.5 Why this shape

- `<Static>` only re-renders when `scrollback` grows — never mutates existing items, never replaces the array. Reducer must always do `[...state.scrollback, newItem]` and treat old items as frozen. Violating this is the #1 way to break terminal scroll.
- Streaming tokens write to `live.streaming`, NOT scrollback. When the AI finishes, the final text *commits* to scrollback in one append and `live` clears. This avoids the classic Ink scroll-jitter problem.
- `overlays` as a stack means `Esc` always pops the top; `/help` over `/settings` over REPL all work without screen routing.

## 5. Input and overlay system

### 5.1 Text input

Lifted from sample2's `useTextInput` (copy-and-tidy territory — sample2 handles many edge cases we shouldn't redo):

- Cursor positioning, word-jump (Alt+←/→), home/end, kill-line.
- History (`↑`/`↓`) backed by `state.input.history`, persisted to `~/.relayos/rtui_history` on exit.
- Paste detection — bracketed paste mode toggled on mount, off on unmount.
- History is **per-project**, keyed by `cwd`, so `relays` in one repo doesn't surface another repo's history.

### 5.2 Keybinding dispatcher

`useKeybindings(scope, bindings)`:

- Each component declaring keybindings names a scope: `"repl"`, `"overlay:slash"`, `"overlay:settings"`, etc.
- `OverlayHost` activates the top overlay's scope and freezes lower scopes — no key leakage between layers.
- Global keys (`Ctrl+C`, `Ctrl+D`) are scope-agnostic and handled in `Shell.tsx`.

### 5.3 Slash flow

Mirrors sample2 behavior:

1. First `/` typed in an otherwise-empty input → `dispatch(OVERLAY_PUSH("slash"))`. Mid-word `/` (e.g. in a path) does NOT open the palette.
2. `SlashPalette` reads `state.input.value`, filters commands, highlights selection.
3. `↑/↓` moves selection. `Enter` accepts (replaces input value). `Esc` pops overlay AND clears input. `Tab` accepts but stays in input for args.
4. Submitting `/cmd args` → `slashRouter` maps to one of:
   - **overlay push** — `/help`, `/tasks`, `/settings` open overlay screens.
   - **bridge call** — `/status`, `/result`, `/current` print to scrollback.
   - **stateful action** — `/approve`, `/run` touch `pendingProposal` / `currentTaskId` via bridge.
   - **shell exit** — `/exit` dispatches unmount.

### 5.4 Confirm dialogs

`bridge.confirm(message)` returns `Promise<boolean>` by pushing a `ConfirmDialog` overlay and resolving on yes/no. Used for risky things like `/run` execution.

### 5.5 Non-TTY mode

If `!process.stdout.isTTY` (piped, CI), `Shell.tsx` mounts a fallback `<StreamingTransport>` that writes plain lines via `stdoutTransport.ts` and reads stdin as one message. No overlays, no input row. Same bridge underneath — same conversation, just no UI.

## 6. Build, runtime, and AGENTS.md

### 6.1 Toolchain (single tool everywhere)

| Layer | Choice | Why |
|---|---|---|
| Runtime | Bun ≥1.3 (required) | one runtime everywhere; matches sample2 |
| Bundler | `bun build` (drop tsup) | one build command |
| Tests | `bun test` (drop vitest) | one test runner |
| Type check | `bun x tsc --noEmit` | unchanged |
| JSX | `react-jsx` automatic | no React import boilerplate |

### 6.2 `package.json` (final shape)

```json
{
  "scripts": {
    "build": "bun build src/index.ts --outdir dist --target bun && bun build src/cli.ts --outdir dist --target bun && bun build src/rtui/index.tsx --outdir dist --target bun",
    "dev": "bun --watch run src/rtui/index.tsx",
    "test": "bun test",
    "typecheck": "bun x tsc --noEmit"
  },
  "dependencies": {
    "ink": "^5.0.0",
    "react": "^18.3.0",
    "@modelcontextprotocol/sdk": "^1.20.0",
    "ulid": "^2.4.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "bun-types": "^1.3.0",
    "@types/react": "^18.3.0",
    "typescript": "^5.7.2"
  }
}
```

`tsup`, `tsx`, `vitest` are removed.

### 6.3 `bin/relays` and `bin/relayos` change

Both shebangs switch from `node` to `bun`. `bin/relays` adds a routing branch:

```sh
# bin/relays — new
if [ "$#" -eq 0 ] || [ "$1" = "chat" ]; then
  shift 2>/dev/null
  exec bun "$DIR/../dist/rtui.js" "$@"
fi
# everything else still flows through cli.js
exec bun "$DIR/../dist/cli.js" "$@"
```

### 6.4 Entrypoint (`src/rtui/index.tsx`)

```ts
import { render } from "ink";
import { App } from "./App.js";

const argv = process.argv.slice(2);
const instance = render(<App argv={argv} />, {
  exitOnCtrlC: false,  // we handle Ctrl+C ourselves
  patchConsole: true,  // route stray console.* into <Static>
});
await instance.waitUntilExit();
```

`patchConsole: true` is important — existing RelayOS internals (overseer, conversation, ai_planner) log to stdout. Without patching, those would corrupt the Ink frame buffer.

### 6.5 Deliberately NOT adopted from sample2

These all hurt agent legibility:

- ❌ `bun:bundle` feature flags + `feature()` calls — invisible dead-code elimination is a debugging trap.
- ❌ `MACRO.VERSION` / `MACRO.BUILD_TIME` `--define` constants — read from `package.json` at runtime instead.
- ❌ `plugins/bunBundleDev.ts` — no custom Bun plugins.
- ❌ Dynamic `import()` for lazy loading — every dep gets a normal top-of-file `import`.
- ❌ React 19 canary / `react-compiler-runtime` — stable React 18 + Ink 5.

### 6.6 `src/rtui/AGENTS.md` (~150 lines)

First file any agent should read when touching RTUI. Contents:

- 5-line architecture summary (REPL + overlays, useReducer store, `runtime/bridge.ts` boundary).
- File-by-file index of `src/rtui/` with one-line purpose each.
- "How to add a slash command" recipe (touch `slashRouter.ts` + optional overlay + bridge method).
- "How to add an overlay" recipe (component + register with OverlayHost + scope keybindings).
- "How to add a scrollback item type" recipe (add variant + reducer case + ScrollbackArea match arm).
- "Gotchas" section: `<Static>` immutability rule, `patchConsole` interaction, non-TTY mode.
- Pointer to sample2 with "look here first for patterns we don't have."

Repo-root `CLAUDE.md` is updated with a one-liner: "when work touches `src/rtui/`, read `src/rtui/AGENTS.md` first."

## 7. Migration plan — porting `bin/relays` functions in later

Each phase ends in a green-bar checkpoint: the TUI still runs end-to-end.

### Phase 0 — Foundation (no RelayOS logic yet)

Output: a TUI that types and echoes.

- `src/rtui/index.tsx`, `App.tsx`, `Shell.tsx`, `state/store.ts`, `state/context.tsx`.
- `ScrollbackArea`, `LiveRegion`, `InputRow`, `StatusLine`.
- Submitting text appends `user_input` to scrollback and echoes a stub `assistant_text`.
- `Ctrl+C` exits cleanly. Non-TTY mode pipes through.
- `bin/relays` repointed at `dist/rtui.js`.

✅ Ship-able. `relays` opens a working (but empty) chat shell.

### Phase 1 — Overlay system + slash router skeleton

Output: `/help` and `/exit` work.

- `OverlayHost`, `SlashPalette`, `HelpOverlay`, `ConfirmDialog`.
- `useKeybindings` dispatcher with scoping.
- `slashRouter.ts` with two commands registered: `/help`, `/exit`.

✅ Slash UX feels right before any RelayOS data flows.

### Phase 2 — `runtime/bridge.ts` facade + read-only commands

Output: `/status`, `/tasks`, `/current`, `/result` print to scrollback.

- `bridge.ts` exposes: `getRuntimeView()`, `getStatus()`, `listRecentTasks()`, `getCurrentTask()`, `getCurrentResult()`.
- Each is a one-line wrapper over the existing `src/overseer.ts` exports (`readRecentTasks`, `readTaskById`, `readLatestHandoffResults`, etc.).
- `StatusLine` reads `runtime` from store, populated by `bridge.getRuntimeView()` on mount.

✅ TUI is now useful — read-only inspection of overseer state works.

### Phase 3 — AI conversation routing

Output: typing free text gets a real response.

- `bridge.routeConversation(text)` wraps `handleConversation` from `src/conversation.ts`.
- Returns `AsyncIterable<ChunkEvent>`. If `conversation.ts` doesn't expose chunks today (likely returns a final string), this phase begins with a small refactor to expose them. If streaming isn't feasible, fall back to spinner + single commit — graceful degradation.
- `LiveRegion` displays streaming tokens; on completion, commit to scrollback.
- `extractActionIntentFromReply` (already in `chat.ts`) runs on completion. If intent found, `bridge.proposeAction()` produces `PendingActionProposal` → `dispatch(PROPOSAL_PENDING)`.

✅ Core chat loop works.

### Phase 4 — Action commands: `/approve`, `/run`

Output: handoff lifecycle in TUI.

- `bridge.approvePending()` wraps `decideApproveAction` + `buildHandoffInputFromPending` + `createHandoff` (all already in `chat.ts` / `tools/`).
- `bridge.runHandoff(id)` wraps the overseer execute-handoff path.
- Both use `ConfirmDialog` overlay for the y/n.

✅ Feature-parity with current `chat.ts` slash commands.

### Phase 5 — `/settings` wizard as overlay

Output: settings reachable without leaving chat.

- `SettingsWizard.tsx` overlay — a multi-step form inside an Ink box.
- Reuses `runSettingsWizard` logic from `src/settings.ts`, but rewritten to drive off store state rather than readline prompts. This is the one place where porting is more than a wrapper — `settings.ts` today is interactive readline, RTUI needs the wizard as declarative steps over store state. Estimate: ~1 day of focused rewrite.

✅ Full chat replacement.

### Phase 6 — Cleanup

Output: `src/chat.ts` deleted.

- Move `extractActionIntentFromReply`, `buildHandoffInputFromPending`, `resolveRunHandoffId`, `decideApproveAction`, `buildChatHelpText` from `chat.ts` into `src/rtui/runtime/bridge.ts` (or split into `runtime/proposal.ts`).
- Delete `src/chat.ts`.
- `cli.ts` no longer imports from `chat.ts`; the `chat` subcommand in `cli.ts` becomes a thin stub: "use `relays` directly."

✅ Single TUI code path.

## 8. Testing

Single rule: every overlay and every slash command gets a test. Components that only render derived state don't.

### 8.1 Stack

- `bun test` runner.
- `ink-testing-library` for component rendering (`render` returns `lastFrame()` and `stdin.write()`).
- Plain TS unit tests for `state/store.ts` (reducer) and `input/slashRouter.ts` (pure functions).

### 8.2 Coverage targets

| Layer | Test type | Examples |
|---|---|---|
| `state/store.ts` | Pure unit | reducer transitions for every action; overlay push/pop invariants; scrollback append-only contract |
| `input/slashRouter.ts` | Pure unit | `/help` → push overlay; `/run abc` → bridge call with id; `/foo` → error scrollback item |
| `overlays/*.tsx` | ink-testing | open, filter, select, dismiss; focus capture; esc-pops; tab-completes |
| `screens/InputRow.tsx` | ink-testing | text typing, cursor, history ↑/↓, paste mode |
| `screens/ScrollbackArea.tsx` | ink-testing | renders each ScrollbackItem variant; never re-renders past items (snapshot-stable) |
| `runtime/bridge.ts` | Integration | each method called with a fake `overseer` module → returns expected shape |
| `App.tsx` end-to-end | ink-testing | mount → type "/help" → assert overlay frame contains help text → type esc → assert gone |

### 8.3 Not tested

- Visual color/spacing — drift from terminal-to-terminal; eyeball it.
- Streaming token timing — flaky; test that final committed text matches, not the chunking.
- `LiveRegion` spinner frames — animation; not behavior.

### 8.4 Snapshot policy

- Allowed for `ScrollbackArea` final frames (proves rendering stable).
- Banned for `LiveRegion` (changes every tick).
- Banned for overlays (better to assert specific text matches than full frames).

### 8.5 Conventions

- Tests live next to source: `store.ts` + `store.test.ts`. One less directory to remember.
- Fixture: `src/rtui/__fixtures__/fakeOverseer.ts` returns deterministic task / handoff records so phase 2+ bridge tests don't need a real `.relayos/` directory.

## 9. Risks and gotchas

1. **Sample2 licensing.** Sample2 is leaked Anthropic source — not MIT. Treat as reference only; copy-and-tidy fallback is acceptable for internal RelayOS, but anything copied verbatim must be flagged in `src/rtui/COPIED_FROM_SAMPLE2.md` and rewritten before a public `relayos-mcp` npm release. Third-party MIT npm packages (Ink, React, ink-text-input, etc.) are fine as-is.
2. **Bun as a hard runtime requirement breaks current `npm install -g relayos-mcp` users.** README must document `curl -fsSL https://bun.sh/install | bash` as a prerequisite. Accepted per "easier for agents > easier for humans."
3. **`<Static>` immutability is easy to violate.** A single `state.scrollback = [...]` with a different identity for an old item re-renders history and breaks terminal scroll. Reducer must always do `[...state.scrollback, newItem]` and treat old items as frozen. Test in §8 enforces this.
4. **Streaming + `<Static>` interaction.** `conversation.ts` today returns a final string. Phase 3 may need a small refactor to expose chunks. If not feasible, `LiveRegion` shows a spinner only and `assistant_text` commits all at once — degrades gracefully.
5. **`runSettingsWizard` is interactive readline.** Phase 5 has the most rewriting — the wizard's state machine is recoverable, but the I/O assumptions aren't.
6. **`cli.ts` is 2,585 lines and imports from `chat.ts`.** Phase 6 cleanup must rewire `cli.ts`'s `chat` subcommand. ~5–10 import sites. Low risk; don't forget it.

## 10. Open questions (non-blocking)

- a. Should `relays` (no args) auto-open the slash palette, or wait for the user to type `/`? Sample2 waits. **Default: wait.**
- b. Persisted input history — confirmed per-project (§5.1).
- c. Theme — single dark theme for v1. Sample2's `/theme` switcher is out of v1 scope.

## 11. Out of scope

- Multi-pane layouts (split-screen task list, etc.).
- Vim mode, voice input, plugin system — all present in sample2, none needed for RelayOS.
- Replacing `bin/relayos` or `cli.ts` non-chat subcommands. Those remain unchanged.
- Publishing a public `relayos-mcp` npm release with Bun as a runtime requirement (separate decision; needs README + distribution review).

## 12. Glossary

- **RTUI** — RelayOS Terminal UI; the new React + Ink TUI at `src/rtui/`.
- **Bridge** — `src/rtui/runtime/bridge.ts`, the single boundary between RTUI and the rest of RelayOS.
- **Overlay** — a transient modal box rendered above the REPL; tracked in `state.overlays` as a stack.
- **Scrollback** — historical lines rendered via Ink `<Static>`; append-only and frozen.
- **Live region** — the re-rendering area between scrollback and input; holds spinner / streaming tokens / progress.
- **Sample2** — `/Users/randy/GID/sample2/`, the leaked Claude Code source used as architectural reference.
