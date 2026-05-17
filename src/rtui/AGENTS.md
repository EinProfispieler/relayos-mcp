# RTUI — Agent Onboarding

**Read this first** when modifying anything under `src/rtui/`.

## What this is

The new React + Ink TUI that owns `relays` and `relays chat`. Replaces the
old readline chat in `src/chat.ts` (still active during the phased migration
— see `docs/superpowers/specs/2026-05-17-rtui-design.md` §7).

## 30-second architecture

- **One screen, no router.** `Shell.tsx` renders three vertical slots:
  scrollback (top, frozen via `<Static>`), live region (middle, re-renders
  freely), input row + status line (bottom).
- **One store.** `state/store.ts` is a `useReducer` reducer. Components
  subscribe via `useRTUI()` from `state/context.tsx`. Never use local
  `useState` for anything domain-related.
- **One boundary.** Anything outside RTUI (`src/overseer.ts`,
  `src/conversation.ts`, `src/settings.ts`) is reached only through
  `runtime/bridge.ts` (added in Phase 2 — does not exist in Phase 0).

## Critical rule: `<Static>` immutability

`ScrollbackArea` uses Ink's `<Static>` so old lines never re-render. This
breaks if the reducer mutates an existing scrollback item or rebuilds the
array with different identities for old items.

**Always:** `{ ...state, scrollback: [...state.scrollback, newItem] }`
**Never:** mutate `state.scrollback[i]` or `.map(...)` the whole array.

Tests in `state/store.test.ts` enforce this — don't disable them.

## File index (Phase 0)

| File | Purpose |
|---|---|
| `index.tsx` | `bun build` entry; calls `render(<App/>)` |
| `App.tsx` | Mounts `RTUIProvider` + `Shell` |
| `Shell.tsx` | Composes ScrollbackArea / LiveRegion / InputRow / StatusLine |
| `state/types.ts` | Discriminated unions for state, actions, scrollback items |
| `state/store.ts` | Reducer + `initialState()` factory |
| `state/context.tsx` | `RTUIProvider` and `useRTUI()` hook |
| `screens/ScrollbackArea.tsx` | `<Static>` log; switches by `item.type` |
| `screens/LiveRegion.tsx` | Spinner / streaming text (Phase 0 stub) |
| `screens/InputRow.tsx` | Prompt + text input + Enter submits |
| `screens/StatusLine.tsx` | One-line status (model/dir/branch/pending) |
| `runtime/runtimeInfo.ts` | `getRuntimeView()` — cwd + git branch + model |
| `runtime/echo.ts` | Stub assistant response (replaced in Phase 3) |
| `runtime/stdoutTransport.ts` | Non-TTY fallback |
| `theme/colors.ts` | Ink Text wrappers around `chat_ui_framework` colors |

## How to run / test / build

```bash
bun run dev:rtui            # hot-reload TUI (Bun --watch)
bun test src/rtui/          # all RTUI tests
bun test src/rtui/state/    # one folder
bun run build:rtui          # bundles to dist/rtui.js
```

## How to add things (Phase 1+ recipes)

These features don't exist in Phase 0. Refer to spec §7 for ordering.

- **New scrollback item type:** add a variant to `state/types.ts:ScrollbackItem`,
  handle the new `type` in `ScrollbackArea.tsx` match arm, no reducer change needed.
- **New action:** add to `state/types.ts:RTUIAction`, handle in
  `state/store.ts:reducer`, write test in `state/store.test.ts`.
- **New slash command (Phase 1+):** add entry to `input/slashRouter.ts`, plus
  either an overlay component or a `bridge.ts` method.

## Gotchas

- `render()` is called with `patchConsole: true` so stray `console.log` from
  RelayOS internals lands in `<Static>` rather than corrupting the frame.
  Don't disable this.
- `exitOnCtrlC: false` — Ctrl+C is handled in `Shell.tsx` via global keybinding
  so we can flush state before exit.
- Non-TTY mode (`!process.stdout.isTTY`) skips Ink entirely and uses
  `runtime/stdoutTransport.ts` for plain-line I/O. Same store underneath.

## When you need a pattern we don't have

Look at `/Users/randy/GID/sample2/src/` (leaked Claude Code source — reference
only, not redistributable). Components live in `sample2/src/components/`,
screens in `sample2/src/screens/`, hooks in `sample2/src/hooks/`. The REPL
screen is the closest analogue to `Shell.tsx`.

If you copy non-trivial code from sample2, log it in
`src/rtui/COPIED_FROM_SAMPLE2.md` (create on first copy) so it can be
rewritten before public npm release.
