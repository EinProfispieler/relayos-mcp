# RTUI Phase 0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working React + Ink TUI shell at `src/rtui/` that boots when the user runs `relays` (or `relays chat`), accepts typed input, echoes it back through scrollback, and exits cleanly — with zero RelayOS business logic wired in yet.

**Architecture:** Single REPL screen (`Shell.tsx`) with three vertical slots — `<Static>` scrollback (append-only, frozen), live region (re-rendering spinner/stream area), and input row + status line. State lives in one `useReducer` exposed via `RTUIContext`. Phase 0 does **not** include overlays, slash routing, or RelayOS bridges — those land in Phase 1 and 2.

**Tech Stack:**
- Runtime: Bun ≥1.3 (must be installed; not present on dev machine today)
- Language: TypeScript (strict, ES2022, `react-jsx`)
- UI: Ink 7.0.3 + React 19.2.6 (peer-required by Ink 7)
- Testing: `bun test` + `ink-testing-library` 4.0.0
- Bundler: `bun build` (additive — existing `tsup` bundles for `cli.ts` / `index.ts` keep working in Phase 0)

**Spec reference:** `docs/superpowers/specs/2026-05-17-rtui-design.md`

**Version note vs. spec:** Spec §6 said React 18 + Ink 5. Actual current versions on npm are React 19.2.6 + Ink 7.0.3 (Ink 7 requires React ≥19.2). Sample2 uses React 19 canary, so this is closer to sample2 than the spec figure was. No design impact.

**Out of scope for Phase 0** (deferred per spec §7):
- Overlay system, slash palette, `/help`, `/exit` slash commands — Phase 1
- `runtime/bridge.ts` and overseer reads — Phase 2
- AI conversation routing — Phase 3
- `/approve`, `/run` action commands — Phase 4
- `/settings` wizard — Phase 5
- `chat.ts` deletion — Phase 6
- Migrating MCP server (`src/index.ts`) or `src/cli.ts` off `tsup` — separate plan

---

## File Manifest

**Created:**
- `src/rtui/AGENTS.md` — agent onboarding doc
- `src/rtui/index.tsx` — `bun build` entry
- `src/rtui/App.tsx` — root component, mounts provider + Shell
- `src/rtui/Shell.tsx` — scrollback + live + input + status composition
- `src/rtui/state/types.ts` — store/action/scrollback types
- `src/rtui/state/store.ts` — reducer + initial state factory
- `src/rtui/state/store.test.ts` — reducer unit tests
- `src/rtui/state/context.tsx` — `RTUIProvider` + `useRTUI()` hook
- `src/rtui/state/context.test.tsx` — provider mount test
- `src/rtui/screens/ScrollbackArea.tsx`
- `src/rtui/screens/ScrollbackArea.test.tsx`
- `src/rtui/screens/LiveRegion.tsx`
- `src/rtui/screens/LiveRegion.test.tsx`
- `src/rtui/screens/InputRow.tsx`
- `src/rtui/screens/InputRow.test.tsx`
- `src/rtui/screens/StatusLine.tsx`
- `src/rtui/screens/StatusLine.test.tsx`
- `src/rtui/Shell.test.tsx`
- `src/rtui/App.test.tsx` — end-to-end smoke
- `src/rtui/runtime/runtimeInfo.ts` — git branch/cwd helpers
- `src/rtui/runtime/echo.ts` — fake assistant response stub
- `src/rtui/runtime/echo.test.ts`
- `src/rtui/runtime/stdoutTransport.ts` — non-TTY fallback
- `src/rtui/runtime/stdoutTransport.test.ts`
- `src/rtui/theme/colors.ts` — Ink Text helpers wrapping `chat_ui_framework`

**Modified:**
- `package.json` — add `ink`, `react`, `react-devtools-core`, `@types/react`, `ink-testing-library`, `bun-types`; add `dev:rtui`, `build:rtui` scripts
- `tsconfig.json` — `jsx: "react-jsx"`, `jsxImportSource: "react"`, add `bun-types` to `types`
- `.gitignore` — add `sample2/`, `samplecode/`, `dist/rtui.js`
- `bin/relays` — route `chat` (default) to `dist/rtui.js` via `bun`
- `CLAUDE.md` (repo root, if exists) — pointer to `src/rtui/AGENTS.md`

---

## Task 1: Install Bun and verify

**Why first:** Every subsequent task uses `bun` for install, test, build, or run. Without Bun, nothing executes.

**Files:** (none — environment setup)

- [ ] **Step 1: Install Bun globally**

Run:
```bash
curl -fsSL https://bun.sh/install | bash
```
Expected: prints "bun was installed successfully" and instructs to source the shell rc.

- [ ] **Step 2: Reload shell PATH**

Run:
```bash
source ~/.zshrc 2>/dev/null || source ~/.bashrc 2>/dev/null || true
export PATH="$HOME/.bun/bin:$PATH"
```

- [ ] **Step 3: Verify Bun is on PATH**

Run:
```bash
bun --version
```
Expected: prints a version `≥ 1.3.0` (e.g. `1.3.4`). If "command not found", PATH didn't pick up — open a new terminal tab and retry.

- [ ] **Step 4: Verify Bun's npm-compatible install works in the project**

Run from `/Users/randy/GID`:
```bash
cd /Users/randy/GID && bun install
```
Expected: completes without error. Existing `node_modules` may be re-linked; new lockfile `bun.lockb` may appear. This is fine — `package-lock.json` and `bun.lockb` can coexist during transition.

- [ ] **Step 5: Commit lockfile change (if any)**

Run:
```bash
cd /Users/randy/GID && git status --short
```
If `bun.lockb` appeared:
```bash
cd /Users/randy/GID && git add bun.lockb && git commit -m "Add bun.lockb from initial bun install"
```
If no new files, skip the commit.

---

## Task 2: Add RTUI dependencies

**Files:**
- Modify: `/Users/randy/GID/package.json`

- [ ] **Step 1: Add runtime deps**

Run from `/Users/randy/GID`:
```bash
cd /Users/randy/GID && bun add ink@^7.0.3 react@^19.2.6 react-devtools-core@^7.0.1
```
Expected: three packages added under `dependencies` in `package.json`.

- [ ] **Step 2: Add dev deps**

Run:
```bash
cd /Users/randy/GID && bun add -d @types/react@^19.2.0 ink-testing-library@^4.0.0 bun-types@^1.3.0
```
Expected: three packages added under `devDependencies`.

- [ ] **Step 3: Add `dev:rtui` and `build:rtui` npm scripts**

Edit `/Users/randy/GID/package.json` `scripts` block. Final scripts block should be:
```json
"scripts": {
  "build": "tsup",
  "build:rtui": "bun build src/rtui/index.tsx --outdir dist --target bun --format esm --external react-devtools-core",
  "dev": "tsx src/index.ts",
  "dev:rtui": "bun --watch run src/rtui/index.tsx",
  "test": "vitest run",
  "test:rtui": "bun test src/rtui/",
  "test:watch": "vitest",
  "typecheck": "tsc --noEmit",
  "prepack": "npm run build && npm run build:rtui"
}
```
Note: keep existing `tsup` / `tsx` / `vitest` scripts intact — Phase 0 is additive.

- [ ] **Step 4: Verify install resolves**

Run:
```bash
cd /Users/randy/GID && bun install
```
Expected: completes cleanly. `node_modules/ink`, `node_modules/react`, `node_modules/ink-testing-library` exist.

- [ ] **Step 5: Commit**

Run:
```bash
cd /Users/randy/GID && git add package.json package-lock.json bun.lockb 2>/dev/null
cd /Users/randy/GID && git commit -m "Add ink/react/ink-testing-library deps for RTUI Phase 0"
```

---

## Task 3: Configure TypeScript for JSX

**Files:**
- Modify: `/Users/randy/GID/tsconfig.json`

- [ ] **Step 1: Update tsconfig.json**

Replace entire file content with:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": false,
    "isolatedModules": true,
    "verbatimModuleSyntax": false,
    "noEmit": true,
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "types": ["node", "bun-types"]
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

Changes vs. previous:
- `lib` adds `"DOM"` — React 19 type defs reference DOM types
- `jsx: "react-jsx"` — automatic JSX runtime (no React imports)
- `jsxImportSource: "react"`
- `types` adds `"bun-types"` for `bun:test` and `Bun.*` globals

- [ ] **Step 2: Verify TypeScript still compiles existing code**

Run:
```bash
cd /Users/randy/GID && bun x tsc --noEmit
```
Expected: zero errors. If errors appear from existing files (e.g. `DOM` type conflicts), narrow `lib` back to `["ES2022"]` and use `/// <reference lib="dom" />` only inside RTUI files.

- [ ] **Step 3: Commit**

Run:
```bash
cd /Users/randy/GID && git add tsconfig.json
cd /Users/randy/GID && git commit -m "Enable react-jsx + bun-types in tsconfig"
```

---

## Task 4: Create RTUI directory scaffold + AGENTS.md

**Files:**
- Create: `/Users/randy/GID/src/rtui/AGENTS.md`
- Create: empty dirs for `src/rtui/state/`, `src/rtui/screens/`, `src/rtui/runtime/`, `src/rtui/theme/`, `src/rtui/__fixtures__/`

- [ ] **Step 1: Create directory tree**

Run:
```bash
mkdir -p /Users/randy/GID/src/rtui/state /Users/randy/GID/src/rtui/screens /Users/randy/GID/src/rtui/runtime /Users/randy/GID/src/rtui/theme /Users/randy/GID/src/rtui/__fixtures__
```

- [ ] **Step 2: Write src/rtui/AGENTS.md**

Create `/Users/randy/GID/src/rtui/AGENTS.md` with this content:

````markdown
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
````

- [ ] **Step 3: Commit**

Run:
```bash
cd /Users/randy/GID && git add src/rtui/AGENTS.md
cd /Users/randy/GID && git commit -m "Scaffold src/rtui/ with AGENTS.md"
```

---

## Task 5: State types (state/types.ts)

**Why no test:** Pure type declarations — `tsc --noEmit` is the test. No runtime behavior.

**Files:**
- Create: `/Users/randy/GID/src/rtui/state/types.ts`

- [ ] **Step 1: Write the types module**

Create `/Users/randy/GID/src/rtui/state/types.ts`:
```ts
export type EffortLevel = "low" | "medium" | "high";

export type Status =
  | "idle"
  | "thinking"
  | "awaiting_approval"
  | "executing";

export interface RuntimeView {
  projectDir: string;
  branch: string;
  model: string;
  effort: EffortLevel;
  isGitRepo: boolean;
}

export interface SessionInfo {
  id: string;
  startedAt: string;
  messageCount: number;
}

export type ScrollbackItem =
  | { id: string; type: "user_input"; text: string }
  | { id: string; type: "assistant_text"; text: string }
  | { id: string; type: "system_note"; text: string }
  | { id: string; type: "error"; text: string }
  | { id: string; type: "divider" };

export interface LiveState {
  spinner: string | null;
  streaming: string | null;
  progress: number | null;
}

export interface InputState {
  value: string;
  cursor: number;
  history: string[];
  historyIndex: number | null;
}

export interface RTUIState {
  session: SessionInfo;
  runtime: RuntimeView;
  scrollback: ScrollbackItem[];
  live: LiveState;
  input: InputState;
  status: Status;
}

export type RTUIAction =
  | { type: "INPUT_CHANGED"; value: string; cursor: number }
  | { type: "INPUT_SUBMITTED" }
  | { type: "HISTORY_PREV" }
  | { type: "HISTORY_NEXT" }
  | { type: "SCROLLBACK_APPEND"; item: ScrollbackItem }
  | { type: "LIVE_SET_SPINNER"; spinner: string | null }
  | { type: "LIVE_SET_STREAM"; text: string | null }
  | { type: "LIVE_CLEAR" }
  | { type: "STATUS_SET"; status: Status }
  | { type: "RUNTIME_UPDATED"; runtime: RuntimeView };
```

- [ ] **Step 2: Verify it type-checks**

Run:
```bash
cd /Users/randy/GID && bun x tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 3: Commit**

Run:
```bash
cd /Users/randy/GID && git add src/rtui/state/types.ts
cd /Users/randy/GID && git commit -m "Add RTUI state and action types"
```

---

## Task 6: Reducer (state/store.ts) — TDD

**Files:**
- Create: `/Users/randy/GID/src/rtui/state/store.test.ts`
- Create: `/Users/randy/GID/src/rtui/state/store.ts`

- [ ] **Step 1: Write failing reducer tests**

Create `/Users/randy/GID/src/rtui/state/store.test.ts`:
```ts
import { describe, expect, test } from "bun:test";
import { initialState, reducer } from "./store.js";
import type { RTUIState, ScrollbackItem } from "./types.js";

const baseState = (): RTUIState =>
  initialState({
    projectDir: "test",
    branch: "main",
    model: "test-model",
    effort: "medium",
    isGitRepo: true,
  });

describe("INPUT_CHANGED", () => {
  test("updates value and cursor", () => {
    const next = reducer(baseState(), {
      type: "INPUT_CHANGED",
      value: "hi",
      cursor: 2,
    });
    expect(next.input.value).toBe("hi");
    expect(next.input.cursor).toBe(2);
  });
});

describe("INPUT_SUBMITTED", () => {
  test("clears input value and cursor", () => {
    const start = { ...baseState() };
    start.input = { ...start.input, value: "hello", cursor: 5 };
    const next = reducer(start, { type: "INPUT_SUBMITTED" });
    expect(next.input.value).toBe("");
    expect(next.input.cursor).toBe(0);
  });

  test("prepends submitted value to history (deduplicated)", () => {
    const start = { ...baseState() };
    start.input = { ...start.input, value: "hello", cursor: 5, history: ["older"] };
    const next = reducer(start, { type: "INPUT_SUBMITTED" });
    expect(next.input.history).toEqual(["hello", "older"]);
  });

  test("does not duplicate consecutive history entries", () => {
    const start = { ...baseState() };
    start.input = { ...start.input, value: "hello", cursor: 5, history: ["hello"] };
    const next = reducer(start, { type: "INPUT_SUBMITTED" });
    expect(next.input.history).toEqual(["hello"]);
  });

  test("empty value submission is a no-op", () => {
    const start = baseState();
    const next = reducer(start, { type: "INPUT_SUBMITTED" });
    expect(next).toBe(start);
  });
});

describe("SCROLLBACK_APPEND", () => {
  test("appends new item without mutating old array", () => {
    const start = baseState();
    const item: ScrollbackItem = { id: "1", type: "user_input", text: "hi" };
    const next = reducer(start, { type: "SCROLLBACK_APPEND", item });
    expect(next.scrollback).toHaveLength(1);
    expect(next.scrollback[0]).toBe(item);
    expect(next.scrollback).not.toBe(start.scrollback);
  });

  test("preserves old item identities on append (Static rule)", () => {
    const item1: ScrollbackItem = { id: "1", type: "user_input", text: "first" };
    const item2: ScrollbackItem = { id: "2", type: "user_input", text: "second" };
    const after1 = reducer(baseState(), { type: "SCROLLBACK_APPEND", item: item1 });
    const after2 = reducer(after1, { type: "SCROLLBACK_APPEND", item: item2 });
    expect(after2.scrollback[0]).toBe(after1.scrollback[0]); // same reference!
    expect(after2.scrollback[1]).toBe(item2);
  });
});

describe("LIVE_*", () => {
  test("LIVE_SET_SPINNER sets spinner", () => {
    const next = reducer(baseState(), { type: "LIVE_SET_SPINNER", spinner: "⠋" });
    expect(next.live.spinner).toBe("⠋");
  });

  test("LIVE_SET_STREAM sets streaming text", () => {
    const next = reducer(baseState(), { type: "LIVE_SET_STREAM", text: "partial" });
    expect(next.live.streaming).toBe("partial");
  });

  test("LIVE_CLEAR clears all live state", () => {
    let state = reducer(baseState(), { type: "LIVE_SET_SPINNER", spinner: "⠋" });
    state = reducer(state, { type: "LIVE_SET_STREAM", text: "partial" });
    const next = reducer(state, { type: "LIVE_CLEAR" });
    expect(next.live.spinner).toBeNull();
    expect(next.live.streaming).toBeNull();
    expect(next.live.progress).toBeNull();
  });
});

describe("STATUS_SET", () => {
  test("updates status", () => {
    const next = reducer(baseState(), { type: "STATUS_SET", status: "thinking" });
    expect(next.status).toBe("thinking");
  });
});

describe("RUNTIME_UPDATED", () => {
  test("replaces runtime view", () => {
    const next = reducer(baseState(), {
      type: "RUNTIME_UPDATED",
      runtime: {
        projectDir: "other",
        branch: "feature",
        model: "new-model",
        effort: "high",
        isGitRepo: false,
      },
    });
    expect(next.runtime.branch).toBe("feature");
    expect(next.runtime.model).toBe("new-model");
  });
});

describe("HISTORY_PREV/NEXT", () => {
  test("HISTORY_PREV loads most recent entry into input", () => {
    const start = baseState();
    start.input = { ...start.input, history: ["second", "first"] };
    const next = reducer(start, { type: "HISTORY_PREV" });
    expect(next.input.value).toBe("second");
    expect(next.input.historyIndex).toBe(0);
  });

  test("HISTORY_PREV stops at oldest entry", () => {
    const start = baseState();
    start.input = { ...start.input, history: ["second", "first"], historyIndex: 1 };
    const next = reducer(start, { type: "HISTORY_PREV" });
    expect(next.input.value).toBe("first");
    expect(next.input.historyIndex).toBe(1);
  });

  test("HISTORY_NEXT clears index past newest", () => {
    const start = baseState();
    start.input = { ...start.input, history: ["second"], historyIndex: 0, value: "second" };
    const next = reducer(start, { type: "HISTORY_NEXT" });
    expect(next.input.historyIndex).toBeNull();
    expect(next.input.value).toBe("");
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

Run:
```bash
cd /Users/randy/GID && bun test src/rtui/state/store.test.ts
```
Expected: all tests fail with "Cannot find module './store.js'" or similar.

- [ ] **Step 3: Write the reducer**

Create `/Users/randy/GID/src/rtui/state/store.ts`:
```ts
import type { RTUIAction, RTUIState, RuntimeView } from "./types.js";

const HISTORY_LIMIT = 500;

function newSessionId(): string {
  return `rtui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function initialState(runtime: RuntimeView): RTUIState {
  return {
    session: {
      id: newSessionId(),
      startedAt: new Date().toISOString(),
      messageCount: 0,
    },
    runtime,
    scrollback: [],
    live: { spinner: null, streaming: null, progress: null },
    input: { value: "", cursor: 0, history: [], historyIndex: null },
    status: "idle",
  };
}

export function reducer(state: RTUIState, action: RTUIAction): RTUIState {
  switch (action.type) {
    case "INPUT_CHANGED":
      return {
        ...state,
        input: { ...state.input, value: action.value, cursor: action.cursor, historyIndex: null },
      };

    case "INPUT_SUBMITTED": {
      const trimmed = state.input.value;
      if (trimmed.length === 0) return state;
      const dedupedHistory =
        state.input.history[0] === trimmed
          ? state.input.history
          : [trimmed, ...state.input.history].slice(0, HISTORY_LIMIT);
      return {
        ...state,
        input: {
          value: "",
          cursor: 0,
          history: dedupedHistory,
          historyIndex: null,
        },
        session: { ...state.session, messageCount: state.session.messageCount + 1 },
      };
    }

    case "HISTORY_PREV": {
      const { history, historyIndex } = state.input;
      if (history.length === 0) return state;
      const nextIndex =
        historyIndex === null ? 0 : Math.min(historyIndex + 1, history.length - 1);
      const value = history[nextIndex] ?? "";
      return {
        ...state,
        input: { ...state.input, value, cursor: value.length, historyIndex: nextIndex },
      };
    }

    case "HISTORY_NEXT": {
      const { history, historyIndex } = state.input;
      if (historyIndex === null) return state;
      const nextIndex = historyIndex - 1;
      if (nextIndex < 0) {
        return {
          ...state,
          input: { ...state.input, value: "", cursor: 0, historyIndex: null },
        };
      }
      const value = history[nextIndex] ?? "";
      return {
        ...state,
        input: { ...state.input, value, cursor: value.length, historyIndex: nextIndex },
      };
    }

    case "SCROLLBACK_APPEND":
      return { ...state, scrollback: [...state.scrollback, action.item] };

    case "LIVE_SET_SPINNER":
      return { ...state, live: { ...state.live, spinner: action.spinner } };

    case "LIVE_SET_STREAM":
      return { ...state, live: { ...state.live, streaming: action.text } };

    case "LIVE_CLEAR":
      return { ...state, live: { spinner: null, streaming: null, progress: null } };

    case "STATUS_SET":
      return { ...state, status: action.status };

    case "RUNTIME_UPDATED":
      return { ...state, runtime: action.runtime };

    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}
```

- [ ] **Step 4: Run tests — confirm they pass**

Run:
```bash
cd /Users/randy/GID && bun test src/rtui/state/store.test.ts
```
Expected: all tests pass (~15 passes).

- [ ] **Step 5: Commit**

Run:
```bash
cd /Users/randy/GID && git add src/rtui/state/store.ts src/rtui/state/store.test.ts
cd /Users/randy/GID && git commit -m "Add RTUI reducer with append-only scrollback"
```

---

## Task 7: Context provider (state/context.tsx) — TDD

**Files:**
- Create: `/Users/randy/GID/src/rtui/state/context.test.tsx`
- Create: `/Users/randy/GID/src/rtui/state/context.tsx`

- [ ] **Step 1: Write failing provider tests**

Create `/Users/randy/GID/src/rtui/state/context.test.tsx`:
```tsx
import { test, expect } from "bun:test";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { RTUIProvider, useRTUI } from "./context.js";
import type { RuntimeView } from "./types.js";

const runtime: RuntimeView = {
  projectDir: "test",
  branch: "main",
  model: "stub",
  effort: "medium",
  isGitRepo: true,
};

function Probe() {
  const { state, dispatch } = useRTUI();
  return <Text>{`status=${state.status} model=${state.runtime.model}`}</Text>;
}

test("provider exposes initial state via useRTUI", () => {
  const { lastFrame } = render(
    <RTUIProvider runtime={runtime}>
      <Probe />
    </RTUIProvider>,
  );
  expect(lastFrame()).toContain("status=idle");
  expect(lastFrame()).toContain("model=stub");
});

test("useRTUI outside provider throws", () => {
  expect(() => {
    render(<Probe />);
  }).toThrow(/RTUIProvider/);
});
```

- [ ] **Step 2: Run tests — confirm they fail**

Run:
```bash
cd /Users/randy/GID && bun test src/rtui/state/context.test.tsx
```
Expected: fails (cannot resolve `./context.js`).

- [ ] **Step 3: Write the provider**

Create `/Users/randy/GID/src/rtui/state/context.tsx`:
```tsx
import { createContext, useContext, useMemo, useReducer, type ReactNode } from "react";
import type { RTUIAction, RTUIState, RuntimeView } from "./types.js";
import { initialState, reducer } from "./store.js";

interface RTUIContextValue {
  state: RTUIState;
  dispatch: (action: RTUIAction) => void;
}

const RTUIContext = createContext<RTUIContextValue | null>(null);

interface ProviderProps {
  runtime: RuntimeView;
  children: ReactNode;
}

export function RTUIProvider({ runtime, children }: ProviderProps) {
  const [state, dispatch] = useReducer(reducer, runtime, initialState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <RTUIContext.Provider value={value}>{children}</RTUIContext.Provider>;
}

export function useRTUI(): RTUIContextValue {
  const ctx = useContext(RTUIContext);
  if (ctx === null) {
    throw new Error("useRTUI must be called inside <RTUIProvider>");
  }
  return ctx;
}
```

- [ ] **Step 4: Run tests — confirm they pass**

Run:
```bash
cd /Users/randy/GID && bun test src/rtui/state/context.test.tsx
```
Expected: 2 passes.

- [ ] **Step 5: Commit**

Run:
```bash
cd /Users/randy/GID && git add src/rtui/state/context.tsx src/rtui/state/context.test.tsx
cd /Users/randy/GID && git commit -m "Add RTUIProvider + useRTUI hook"
```

---

## Task 8: Theme module (theme/colors.ts)

**Files:**
- Create: `/Users/randy/GID/src/rtui/theme/colors.ts`

**Why no test:** Pure constants and re-exports. Visual output is verified by component tests downstream.

- [ ] **Step 1: Write theme module**

Create `/Users/randy/GID/src/rtui/theme/colors.ts`:
```ts
// Semantic color tokens for RTUI. Centralized so future /theme work
// (out of Phase 0 scope) has a single file to swap.

export const colors = {
  prompt: "cyan",
  user: "white",
  assistant: "white",
  system: "gray",
  error: "red",
  pending: "magenta",
  ready: "green",
  thinking: "yellow",
  branch: "blue",
  dim: "gray",
  accent: "cyan",
} as const;

export type ColorKey = keyof typeof colors;
```

- [ ] **Step 2: Verify compile**

Run:
```bash
cd /Users/randy/GID && bun x tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 3: Commit**

Run:
```bash
cd /Users/randy/GID && git add src/rtui/theme/colors.ts
cd /Users/randy/GID && git commit -m "Add RTUI semantic color tokens"
```

---

## Task 9: ScrollbackArea component — TDD

**Files:**
- Create: `/Users/randy/GID/src/rtui/screens/ScrollbackArea.test.tsx`
- Create: `/Users/randy/GID/src/rtui/screens/ScrollbackArea.tsx`

- [ ] **Step 1: Write failing component tests**

Create `/Users/randy/GID/src/rtui/screens/ScrollbackArea.test.tsx`:
```tsx
import { test, expect } from "bun:test";
import { render } from "ink-testing-library";
import { ScrollbackArea } from "./ScrollbackArea.js";
import type { ScrollbackItem } from "../state/types.js";

test("renders user_input with ❯ prefix", () => {
  const items: ScrollbackItem[] = [{ id: "1", type: "user_input", text: "hello" }];
  const { lastFrame } = render(<ScrollbackArea items={items} />);
  expect(lastFrame()).toContain("❯ hello");
});

test("renders assistant_text without prefix", () => {
  const items: ScrollbackItem[] = [{ id: "1", type: "assistant_text", text: "world" }];
  const { lastFrame } = render(<ScrollbackArea items={items} />);
  expect(lastFrame()).toContain("world");
});

test("renders system_note with ✓ prefix", () => {
  const items: ScrollbackItem[] = [{ id: "1", type: "system_note", text: "done" }];
  const { lastFrame } = render(<ScrollbackArea items={items} />);
  expect(lastFrame()).toContain("✓ done");
});

test("renders error with ✗ prefix", () => {
  const items: ScrollbackItem[] = [{ id: "1", type: "error", text: "boom" }];
  const { lastFrame } = render(<ScrollbackArea items={items} />);
  expect(lastFrame()).toContain("✗ boom");
});

test("renders divider as a horizontal rule line", () => {
  const items: ScrollbackItem[] = [{ id: "1", type: "divider" }];
  const { lastFrame } = render(<ScrollbackArea items={items} />);
  expect(lastFrame()).toMatch(/─+/);
});

test("renders multiple items in order", () => {
  const items: ScrollbackItem[] = [
    { id: "1", type: "user_input", text: "first" },
    { id: "2", type: "assistant_text", text: "second" },
  ];
  const { lastFrame } = render(<ScrollbackArea items={items} />);
  const out = lastFrame() ?? "";
  expect(out.indexOf("first")).toBeLessThan(out.indexOf("second"));
});
```

- [ ] **Step 2: Run tests — confirm they fail**

Run:
```bash
cd /Users/randy/GID && bun test src/rtui/screens/ScrollbackArea.test.tsx
```
Expected: all fail.

- [ ] **Step 3: Write the component**

Create `/Users/randy/GID/src/rtui/screens/ScrollbackArea.tsx`:
```tsx
import { Box, Static, Text } from "ink";
import type { ScrollbackItem } from "../state/types.js";
import { colors } from "../theme/colors.js";

interface Props {
  items: ScrollbackItem[];
}

function ItemRow({ item }: { item: ScrollbackItem }) {
  switch (item.type) {
    case "user_input":
      return (
        <Box>
          <Text color={colors.prompt}>❯ </Text>
          <Text color={colors.user}>{item.text}</Text>
        </Box>
      );
    case "assistant_text":
      return <Text color={colors.assistant}>{item.text}</Text>;
    case "system_note":
      return (
        <Box>
          <Text color={colors.ready}>✓ </Text>
          <Text color={colors.system}>{item.text}</Text>
        </Box>
      );
    case "error":
      return (
        <Box>
          <Text color={colors.error}>✗ </Text>
          <Text color={colors.error}>{item.text}</Text>
        </Box>
      );
    case "divider":
      return <Text color={colors.dim}>{"─".repeat(60)}</Text>;
  }
}

export function ScrollbackArea({ items }: Props) {
  return (
    <Static items={items}>
      {(item) => <ItemRow key={item.id ?? "divider"} item={item} />}
    </Static>
  );
}
```

- [ ] **Step 4: Run tests — confirm they pass**

Run:
```bash
cd /Users/randy/GID && bun test src/rtui/screens/ScrollbackArea.test.tsx
```
Expected: 6 passes.

- [ ] **Step 5: Commit**

Run:
```bash
cd /Users/randy/GID && git add src/rtui/screens/ScrollbackArea.tsx src/rtui/screens/ScrollbackArea.test.tsx
cd /Users/randy/GID && git commit -m "Add ScrollbackArea component (Static, append-only)"
```

---

## Task 10: LiveRegion component — TDD

**Files:**
- Create: `/Users/randy/GID/src/rtui/screens/LiveRegion.test.tsx`
- Create: `/Users/randy/GID/src/rtui/screens/LiveRegion.tsx`

- [ ] **Step 1: Write failing component tests**

Create `/Users/randy/GID/src/rtui/screens/LiveRegion.test.tsx`:
```tsx
import { test, expect } from "bun:test";
import { render } from "ink-testing-library";
import { LiveRegion } from "./LiveRegion.js";

test("renders nothing when live is empty", () => {
  const { lastFrame } = render(
    <LiveRegion spinner={null} streaming={null} progress={null} />,
  );
  expect((lastFrame() ?? "").trim()).toBe("");
});

test("renders spinner glyph when spinner is set", () => {
  const { lastFrame } = render(
    <LiveRegion spinner="⠋" streaming={null} progress={null} />,
  );
  expect(lastFrame()).toContain("⠋");
});

test("renders streaming text when set", () => {
  const { lastFrame } = render(
    <LiveRegion spinner={null} streaming="thinking..." progress={null} />,
  );
  expect(lastFrame()).toContain("thinking...");
});

test("renders both spinner and streaming text together", () => {
  const { lastFrame } = render(
    <LiveRegion spinner="⠋" streaming="partial reply" progress={null} />,
  );
  expect(lastFrame()).toContain("⠋");
  expect(lastFrame()).toContain("partial reply");
});
```

- [ ] **Step 2: Run tests — confirm they fail**

Run:
```bash
cd /Users/randy/GID && bun test src/rtui/screens/LiveRegion.test.tsx
```
Expected: all fail.

- [ ] **Step 3: Write the component**

Create `/Users/randy/GID/src/rtui/screens/LiveRegion.tsx`:
```tsx
import { Box, Text } from "ink";
import { colors } from "../theme/colors.js";

interface Props {
  spinner: string | null;
  streaming: string | null;
  progress: number | null;
}

export function LiveRegion({ spinner, streaming, progress }: Props) {
  if (spinner === null && streaming === null && progress === null) {
    return null;
  }
  return (
    <Box>
      {spinner !== null && <Text color={colors.thinking}>{spinner} </Text>}
      {streaming !== null && <Text color={colors.dim}>{streaming}</Text>}
      {progress !== null && <Text color={colors.dim}>{` ${Math.round(progress * 100)}%`}</Text>}
    </Box>
  );
}
```

- [ ] **Step 4: Run tests — confirm they pass**

Run:
```bash
cd /Users/randy/GID && bun test src/rtui/screens/LiveRegion.test.tsx
```
Expected: 4 passes.

- [ ] **Step 5: Commit**

Run:
```bash
cd /Users/randy/GID && git add src/rtui/screens/LiveRegion.tsx src/rtui/screens/LiveRegion.test.tsx
cd /Users/randy/GID && git commit -m "Add LiveRegion component"
```

---

## Task 11: InputRow component — TDD

**Files:**
- Create: `/Users/randy/GID/src/rtui/screens/InputRow.test.tsx`
- Create: `/Users/randy/GID/src/rtui/screens/InputRow.tsx`

- [ ] **Step 1: Write failing component tests**

Create `/Users/randy/GID/src/rtui/screens/InputRow.test.tsx`:
```tsx
import { test, expect } from "bun:test";
import { render } from "ink-testing-library";
import { RTUIProvider } from "../state/context.js";
import { InputRow } from "./InputRow.js";
import type { RuntimeView } from "../state/types.js";

const runtime: RuntimeView = {
  projectDir: "test",
  branch: "main",
  model: "stub",
  effort: "medium",
  isGitRepo: true,
};

test("renders prompt prefix", () => {
  const { lastFrame } = render(
    <RTUIProvider runtime={runtime}>
      <InputRow />
    </RTUIProvider>,
  );
  expect(lastFrame()).toContain("❯");
});

test("typed characters appear in the input", async () => {
  const { lastFrame, stdin } = render(
    <RTUIProvider runtime={runtime}>
      <InputRow />
    </RTUIProvider>,
  );
  stdin.write("hi");
  await new Promise((r) => setTimeout(r, 30));
  expect(lastFrame()).toContain("hi");
});

test("Enter clears the input", async () => {
  const { lastFrame, stdin } = render(
    <RTUIProvider runtime={runtime}>
      <InputRow />
    </RTUIProvider>,
  );
  stdin.write("hello");
  await new Promise((r) => setTimeout(r, 30));
  stdin.write("\r");
  await new Promise((r) => setTimeout(r, 30));
  expect(lastFrame()).not.toContain("hello");
});
```

- [ ] **Step 2: Run tests — confirm they fail**

Run:
```bash
cd /Users/randy/GID && bun test src/rtui/screens/InputRow.test.tsx
```
Expected: all fail.

- [ ] **Step 3: Write the component**

Create `/Users/randy/GID/src/rtui/screens/InputRow.tsx`:
```tsx
import { Box, Text, useInput } from "ink";
import { useRTUI } from "../state/context.js";
import { colors } from "../theme/colors.js";

export function InputRow() {
  const { state, dispatch } = useRTUI();
  const { value, cursor } = state.input;

  useInput((char, key) => {
    if (key.return) {
      dispatch({ type: "INPUT_SUBMITTED" });
      return;
    }
    if (key.upArrow) {
      dispatch({ type: "HISTORY_PREV" });
      return;
    }
    if (key.downArrow) {
      dispatch({ type: "HISTORY_NEXT" });
      return;
    }
    if (key.backspace || key.delete) {
      if (cursor === 0) return;
      const next = value.slice(0, cursor - 1) + value.slice(cursor);
      dispatch({ type: "INPUT_CHANGED", value: next, cursor: cursor - 1 });
      return;
    }
    if (key.leftArrow) {
      dispatch({ type: "INPUT_CHANGED", value, cursor: Math.max(0, cursor - 1) });
      return;
    }
    if (key.rightArrow) {
      dispatch({ type: "INPUT_CHANGED", value, cursor: Math.min(value.length, cursor + 1) });
      return;
    }
    if (key.ctrl || key.meta || char === undefined || char.length === 0) return;
    const next = value.slice(0, cursor) + char + value.slice(cursor);
    dispatch({ type: "INPUT_CHANGED", value: next, cursor: cursor + char.length });
  });

  const before = value.slice(0, cursor);
  const at = value.slice(cursor, cursor + 1) || " ";
  const after = value.slice(cursor + 1);

  return (
    <Box>
      <Text color={colors.prompt}>❯ </Text>
      <Text>{before}</Text>
      <Text inverse>{at}</Text>
      <Text>{after}</Text>
    </Box>
  );
}
```

- [ ] **Step 4: Run tests — confirm they pass**

Run:
```bash
cd /Users/randy/GID && bun test src/rtui/screens/InputRow.test.tsx
```
Expected: 3 passes.

- [ ] **Step 5: Commit**

Run:
```bash
cd /Users/randy/GID && git add src/rtui/screens/InputRow.tsx src/rtui/screens/InputRow.test.tsx
cd /Users/randy/GID && git commit -m "Add InputRow with cursor + history navigation"
```

---

## Task 12: StatusLine component — TDD

**Files:**
- Create: `/Users/randy/GID/src/rtui/screens/StatusLine.test.tsx`
- Create: `/Users/randy/GID/src/rtui/screens/StatusLine.tsx`

- [ ] **Step 1: Write failing component tests**

Create `/Users/randy/GID/src/rtui/screens/StatusLine.test.tsx`:
```tsx
import { test, expect } from "bun:test";
import { render } from "ink-testing-library";
import { RTUIProvider } from "../state/context.js";
import { StatusLine } from "./StatusLine.js";
import type { RuntimeView } from "../state/types.js";

const runtime: RuntimeView = {
  projectDir: "GID",
  branch: "production",
  model: "gpt-5.3-codex",
  effort: "medium",
  isGitRepo: true,
};

test("renders model and effort", () => {
  const { lastFrame } = render(
    <RTUIProvider runtime={runtime}>
      <StatusLine />
    </RTUIProvider>,
  );
  expect(lastFrame()).toContain("gpt-5.3-codex");
  expect(lastFrame()).toContain("medium");
});

test("renders project dir prefixed with ~/", () => {
  const { lastFrame } = render(
    <RTUIProvider runtime={runtime}>
      <StatusLine />
    </RTUIProvider>,
  );
  expect(lastFrame()).toContain("~/GID");
});

test("renders branch name", () => {
  const { lastFrame } = render(
    <RTUIProvider runtime={runtime}>
      <StatusLine />
    </RTUIProvider>,
  );
  expect(lastFrame()).toContain("production");
});

test("renders Ready when status is idle", () => {
  const { lastFrame } = render(
    <RTUIProvider runtime={runtime}>
      <StatusLine />
    </RTUIProvider>,
  );
  expect(lastFrame()).toContain("Ready");
});
```

- [ ] **Step 2: Run tests — confirm they fail**

Run:
```bash
cd /Users/randy/GID && bun test src/rtui/screens/StatusLine.test.tsx
```
Expected: all fail.

- [ ] **Step 3: Write the component**

Create `/Users/randy/GID/src/rtui/screens/StatusLine.tsx`:
```tsx
import { Box, Text } from "ink";
import { useRTUI } from "../state/context.js";
import { colors } from "../theme/colors.js";

function statusLabel(status: string): string {
  switch (status) {
    case "thinking": return "Thinking";
    case "awaiting_approval": return "Awaiting approval";
    case "executing": return "Executing";
    default: return "Ready";
  }
}

export function StatusLine() {
  const { state } = useRTUI();
  const { runtime, status } = state;
  const sep = <Text color={colors.dim}> · </Text>;

  return (
    <Box>
      <Text>{`${runtime.model} ${runtime.effort}`}</Text>
      {sep}
      <Text color={colors.ready}>{`~/${runtime.projectDir}`}</Text>
      {sep}
      <Text color={colors.branch}>{runtime.branch}</Text>
      {sep}
      <Text color={status === "idle" ? colors.ready : colors.pending}>{statusLabel(status)}</Text>
    </Box>
  );
}
```

- [ ] **Step 4: Run tests — confirm they pass**

Run:
```bash
cd /Users/randy/GID && bun test src/rtui/screens/StatusLine.test.tsx
```
Expected: 4 passes.

- [ ] **Step 5: Commit**

Run:
```bash
cd /Users/randy/GID && git add src/rtui/screens/StatusLine.tsx src/rtui/screens/StatusLine.test.tsx
cd /Users/randy/GID && git commit -m "Add StatusLine component"
```

---

## Task 13: Runtime info collection (runtime/runtimeInfo.ts)

**Files:**
- Create: `/Users/randy/GID/src/rtui/runtime/runtimeInfo.ts`
- Create: `/Users/randy/GID/src/rtui/runtime/runtimeInfo.test.ts`

- [ ] **Step 1: Write failing test**

Create `/Users/randy/GID/src/rtui/runtime/runtimeInfo.test.ts`:
```ts
import { test, expect } from "bun:test";
import { getRuntimeView } from "./runtimeInfo.js";

test("returns a RuntimeView with non-empty projectDir and model", () => {
  const view = getRuntimeView();
  expect(view.projectDir.length).toBeGreaterThan(0);
  expect(view.model.length).toBeGreaterThan(0);
  expect(["low", "medium", "high"]).toContain(view.effort);
});

test("branch is a string (empty allowed if not git repo)", () => {
  const view = getRuntimeView();
  expect(typeof view.branch).toBe("string");
});
```

- [ ] **Step 2: Run test — confirm it fails**

Run:
```bash
cd /Users/randy/GID && bun test src/rtui/runtime/runtimeInfo.test.ts
```
Expected: fail.

- [ ] **Step 3: Write the module**

Create `/Users/randy/GID/src/rtui/runtime/runtimeInfo.ts`:
```ts
import { execSync } from "node:child_process";
import { basename, resolve } from "node:path";
import type { RuntimeView } from "../state/types.js";

function safeGit(args: string[]): string {
  try {
    return execSync(`git ${args.join(" ")}`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

export function getRuntimeView(): RuntimeView {
  const cwd = process.cwd();
  const projectDir = basename(resolve(cwd));
  const branch = safeGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  const isGitRepo = branch.length > 0;
  return {
    projectDir,
    branch: branch || "(no branch)",
    model: process.env.RTUI_MODEL ?? "gpt-5.3-codex",
    effort: (process.env.RTUI_EFFORT as "low" | "medium" | "high") ?? "medium",
    isGitRepo,
  };
}
```

- [ ] **Step 4: Run test — confirm it passes**

Run:
```bash
cd /Users/randy/GID && bun test src/rtui/runtime/runtimeInfo.test.ts
```
Expected: 2 passes.

- [ ] **Step 5: Commit**

Run:
```bash
cd /Users/randy/GID && git add src/rtui/runtime/runtimeInfo.ts src/rtui/runtime/runtimeInfo.test.ts
cd /Users/randy/GID && git commit -m "Add getRuntimeView helper (cwd + git branch)"
```

---

## Task 14: Echo stub (runtime/echo.ts)

**Why this exists:** Phase 0 has no AI bridge. We need *something* to write into `assistant_text` so the chat loop visibly closes. `echo.ts` is replaced wholesale in Phase 3.

**Files:**
- Create: `/Users/randy/GID/src/rtui/runtime/echo.ts`
- Create: `/Users/randy/GID/src/rtui/runtime/echo.test.ts`

- [ ] **Step 1: Write failing test**

Create `/Users/randy/GID/src/rtui/runtime/echo.test.ts`:
```ts
import { test, expect } from "bun:test";
import { buildEchoReply } from "./echo.js";

test("returns a non-empty reply prefixed with echo:", () => {
  const reply = buildEchoReply("hello world");
  expect(reply).toBe("echo: hello world");
});

test("trims input", () => {
  const reply = buildEchoReply("   spaced   ");
  expect(reply).toBe("echo: spaced");
});

test("handles empty input as placeholder", () => {
  const reply = buildEchoReply("");
  expect(reply).toBe("echo: (empty)");
});
```

- [ ] **Step 2: Run test — confirm it fails**

Run:
```bash
cd /Users/randy/GID && bun test src/rtui/runtime/echo.test.ts
```
Expected: fail.

- [ ] **Step 3: Write the module**

Create `/Users/randy/GID/src/rtui/runtime/echo.ts`:
```ts
// Phase 0 stub — replaced by bridge.routeConversation in Phase 3.
// Keeps the chat loop visibly closed (input → echo → scrollback) before
// any real AI logic is wired in.
export function buildEchoReply(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) return "echo: (empty)";
  return `echo: ${trimmed}`;
}
```

- [ ] **Step 4: Run test — confirm it passes**

Run:
```bash
cd /Users/randy/GID && bun test src/rtui/runtime/echo.test.ts
```
Expected: 3 passes.

- [ ] **Step 5: Commit**

Run:
```bash
cd /Users/randy/GID && git add src/rtui/runtime/echo.ts src/rtui/runtime/echo.test.ts
cd /Users/randy/GID && git commit -m "Add Phase 0 echo stub for assistant replies"
```

---

## Task 15: Shell composition (Shell.tsx) — TDD

**Files:**
- Create: `/Users/randy/GID/src/rtui/Shell.test.tsx`
- Create: `/Users/randy/GID/src/rtui/Shell.tsx`

- [ ] **Step 1: Write failing test**

Create `/Users/randy/GID/src/rtui/Shell.test.tsx`:
```tsx
import { test, expect } from "bun:test";
import { render } from "ink-testing-library";
import { RTUIProvider } from "./state/context.js";
import { Shell } from "./Shell.js";
import type { RuntimeView } from "./state/types.js";

const runtime: RuntimeView = {
  projectDir: "GID",
  branch: "production",
  model: "stub",
  effort: "medium",
  isGitRepo: true,
};

test("Shell mounts and renders prompt + status line", () => {
  const { lastFrame } = render(
    <RTUIProvider runtime={runtime}>
      <Shell />
    </RTUIProvider>,
  );
  const frame = lastFrame() ?? "";
  expect(frame).toContain("❯");
  expect(frame).toContain("stub");
  expect(frame).toContain("production");
});

test("submitting text appends echo reply to scrollback", async () => {
  const { lastFrame, stdin } = render(
    <RTUIProvider runtime={runtime}>
      <Shell />
    </RTUIProvider>,
  );
  stdin.write("hello");
  await new Promise((r) => setTimeout(r, 30));
  stdin.write("\r");
  await new Promise((r) => setTimeout(r, 50));
  const frame = lastFrame() ?? "";
  expect(frame).toContain("❯ hello");
  expect(frame).toContain("echo: hello");
});
```

- [ ] **Step 2: Run test — confirm it fails**

Run:
```bash
cd /Users/randy/GID && bun test src/rtui/Shell.test.tsx
```
Expected: fail (no Shell module).

- [ ] **Step 3: Write the Shell**

Create `/Users/randy/GID/src/rtui/Shell.tsx`:
```tsx
import { Box } from "ink";
import { useEffect, useRef } from "react";
import { useRTUI } from "./state/context.js";
import { ScrollbackArea } from "./screens/ScrollbackArea.js";
import { LiveRegion } from "./screens/LiveRegion.js";
import { InputRow } from "./screens/InputRow.js";
import { StatusLine } from "./screens/StatusLine.js";
import { buildEchoReply } from "./runtime/echo.js";
import type { ScrollbackItem } from "./state/types.js";

function genId(): string {
  return `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function Shell() {
  const { state, dispatch } = useRTUI();
  const lastSubmittedCount = useRef(state.session.messageCount);

  // Detect a fresh submission by watching messageCount delta.
  useEffect(() => {
    if (state.session.messageCount === lastSubmittedCount.current) return;
    lastSubmittedCount.current = state.session.messageCount;

    // The reducer already cleared input. Reconstruct the submitted text
    // from the freshest history entry.
    const submitted = state.input.history[0];
    if (submitted === undefined) return;

    const userItem: ScrollbackItem = { id: genId(), type: "user_input", text: submitted };
    dispatch({ type: "SCROLLBACK_APPEND", item: userItem });

    const reply = buildEchoReply(submitted);
    const replyItem: ScrollbackItem = { id: genId(), type: "assistant_text", text: reply };
    dispatch({ type: "SCROLLBACK_APPEND", item: replyItem });
  }, [state.session.messageCount, state.input.history, dispatch]);

  return (
    <Box flexDirection="column">
      <ScrollbackArea items={state.scrollback} />
      <LiveRegion
        spinner={state.live.spinner}
        streaming={state.live.streaming}
        progress={state.live.progress}
      />
      <Box marginTop={1} flexDirection="column">
        <InputRow />
        <StatusLine />
      </Box>
    </Box>
  );
}
```

- [ ] **Step 4: Run test — confirm it passes**

Run:
```bash
cd /Users/randy/GID && bun test src/rtui/Shell.test.tsx
```
Expected: 2 passes.

- [ ] **Step 5: Commit**

Run:
```bash
cd /Users/randy/GID && git add src/rtui/Shell.tsx src/rtui/Shell.test.tsx
cd /Users/randy/GID && git commit -m "Compose Shell: scrollback + live + input + status + echo loop"
```

---

## Task 16: Non-TTY fallback (runtime/stdoutTransport.ts)

**Files:**
- Create: `/Users/randy/GID/src/rtui/runtime/stdoutTransport.ts`
- Create: `/Users/randy/GID/src/rtui/runtime/stdoutTransport.test.ts`

- [ ] **Step 1: Write failing test**

Create `/Users/randy/GID/src/rtui/runtime/stdoutTransport.test.ts`:
```ts
import { test, expect } from "bun:test";
import { runStdoutTransport } from "./stdoutTransport.js";

test("reads one line of input and echoes via the writer", async () => {
  const lines: string[] = [];
  const writer = (chunk: string) => { lines.push(chunk); };
  await runStdoutTransport({ writer, input: "hello\n" });
  const joined = lines.join("");
  expect(joined).toContain("❯ hello");
  expect(joined).toContain("echo: hello");
});

test("handles empty input gracefully", async () => {
  const lines: string[] = [];
  const writer = (chunk: string) => { lines.push(chunk); };
  await runStdoutTransport({ writer, input: "" });
  expect(lines.join("")).toContain("echo: (empty)");
});
```

- [ ] **Step 2: Run test — confirm it fails**

Run:
```bash
cd /Users/randy/GID && bun test src/rtui/runtime/stdoutTransport.test.ts
```
Expected: fail.

- [ ] **Step 3: Write the module**

Create `/Users/randy/GID/src/rtui/runtime/stdoutTransport.ts`:
```ts
import { buildEchoReply } from "./echo.js";

interface Options {
  writer: (chunk: string) => void;
  input: string;
}

// Non-TTY mode: read one full message from stdin, write user line +
// echo reply as plain text. No Ink, no React. Same buildEchoReply
// underneath, so Phase 3's bridge swap covers both code paths.
export async function runStdoutTransport({ writer, input }: Options): Promise<void> {
  const cleaned = input.replace(/\n$/, "");
  writer(`❯ ${cleaned}\n`);
  writer(`${buildEchoReply(cleaned)}\n`);
}

export async function readAllStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
```

- [ ] **Step 4: Run test — confirm it passes**

Run:
```bash
cd /Users/randy/GID && bun test src/rtui/runtime/stdoutTransport.test.ts
```
Expected: 2 passes.

- [ ] **Step 5: Commit**

Run:
```bash
cd /Users/randy/GID && git add src/rtui/runtime/stdoutTransport.ts src/rtui/runtime/stdoutTransport.test.ts
cd /Users/randy/GID && git commit -m "Add non-TTY stdoutTransport fallback"
```

---

## Task 17: App.tsx + entrypoint (index.tsx)

**Files:**
- Create: `/Users/randy/GID/src/rtui/App.tsx`
- Create: `/Users/randy/GID/src/rtui/index.tsx`
- Create: `/Users/randy/GID/src/rtui/App.test.tsx`

- [ ] **Step 1: Write the App component**

Create `/Users/randy/GID/src/rtui/App.tsx`:
```tsx
import { useApp, useInput } from "ink";
import { RTUIProvider } from "./state/context.js";
import { Shell } from "./Shell.js";
import { getRuntimeView } from "./runtime/runtimeInfo.js";

export function App() {
  const runtime = getRuntimeView();
  return (
    <RTUIProvider runtime={runtime}>
      <GlobalKeys />
      <Shell />
    </RTUIProvider>
  );
}

function GlobalKeys() {
  const { exit } = useApp();
  useInput((_char, key) => {
    if (key.ctrl && _char === "c") exit();
    if (key.ctrl && _char === "d") exit();
  });
  return null;
}
```

- [ ] **Step 2: Write the entrypoint**

Create `/Users/randy/GID/src/rtui/index.tsx`:
```tsx
import { render } from "ink";
import { App } from "./App.js";
import { readAllStdin, runStdoutTransport } from "./runtime/stdoutTransport.js";

async function main(): Promise<void> {
  if (!process.stdout.isTTY) {
    const input = await readAllStdin();
    await runStdoutTransport({ writer: (c) => process.stdout.write(c), input });
    return;
  }

  const instance = render(<App />, {
    exitOnCtrlC: false,
    patchConsole: true,
  });
  await instance.waitUntilExit();
}

main().catch((err) => {
  process.stderr.write(`rtui crashed: ${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
```

- [ ] **Step 3: Write end-to-end smoke test**

Create `/Users/randy/GID/src/rtui/App.test.tsx`:
```tsx
import { test, expect } from "bun:test";
import { render } from "ink-testing-library";
import { App } from "./App.js";

test("App mounts, accepts input, and echoes reply", async () => {
  const { lastFrame, stdin } = render(<App />);
  stdin.write("smoke");
  await new Promise((r) => setTimeout(r, 30));
  stdin.write("\r");
  await new Promise((r) => setTimeout(r, 60));
  const frame = lastFrame() ?? "";
  expect(frame).toContain("❯ smoke");
  expect(frame).toContain("echo: smoke");
});
```

- [ ] **Step 4: Run all RTUI tests**

Run:
```bash
cd /Users/randy/GID && bun test src/rtui/
```
Expected: all tests pass across every file (~30+ tests total).

- [ ] **Step 5: Commit**

Run:
```bash
cd /Users/randy/GID && git add src/rtui/App.tsx src/rtui/index.tsx src/rtui/App.test.tsx
cd /Users/randy/GID && git commit -m "Add App.tsx + index.tsx entry; non-TTY auto-fallback"
```

---

## Task 18: Bun build verification

**Files:** (none — just produces `dist/rtui.js`)

- [ ] **Step 1: Build the bundle**

Run:
```bash
cd /Users/randy/GID && bun run build:rtui
```
Expected: prints "Bundled X modules" and creates `dist/rtui.js`. No errors.

- [ ] **Step 2: Smoke-run the bundle interactively**

Run from any non-piped terminal:
```bash
cd /Users/randy/GID && bun dist/rtui.js
```
Expected: TUI mounts. You see the prompt `❯` and the status line (`stub medium · ~/GID · production · Ready`). Type `hello`, press Enter — you should see `❯ hello` followed by `echo: hello` in scrollback. Press `Ctrl+C` to exit.

- [ ] **Step 3: Smoke-run the bundle in non-TTY mode**

Run:
```bash
cd /Users/randy/GID && echo "hello from pipe" | bun dist/rtui.js
```
Expected output:
```
❯ hello from pipe
echo: hello from pipe
```

- [ ] **Step 4: Add dist/rtui.js to git ignore (it's a build artifact)**

If `/Users/randy/GID/.gitignore` does not already contain `dist/`, add `dist/rtui.js` to it. Check first:
```bash
cd /Users/randy/GID && cat .gitignore
```
If `dist/` is not present, append:
```bash
cd /Users/randy/GID && printf "\n# RTUI bundle\ndist/rtui.js\n" >> .gitignore
cd /Users/randy/GID && git add .gitignore
cd /Users/randy/GID && git commit -m "Ignore dist/rtui.js build artifact"
```
If `dist/` is already ignored, no action.

---

## Task 19: Repoint bin/relays to RTUI for chat mode

**Files:**
- Modify: `/Users/randy/GID/bin/relays`

- [ ] **Step 1: Replace bin/relays content**

Replace the entire contents of `/Users/randy/GID/bin/relays` with:
```sh
#!/usr/bin/env sh
# User-facing RelayOS shortcut CLI.
# Chat mode (default + `chat`) → dist/rtui.js (React + Ink TUI, requires bun)
# All other subcommands → dist/cli.js (existing Node-based CLI)
SCRIPT="$0"
while [ -h "$SCRIPT" ]; do
  LINK=$(readlink "$SCRIPT")
  case "$LINK" in
    /*) SCRIPT="$LINK" ;;
    *) SCRIPT="$(dirname "$SCRIPT")/$LINK" ;;
  esac
done
DIR=$(cd "$(dirname "$SCRIPT")" && pwd)
CLI_JS="$DIR/../dist/cli.js"
RTUI_JS="$DIR/../dist/rtui.js"

print_help() {
  cat <<'EOF'
relays - RelayOS quick CLI

Usage:
  relays                    Start RTUI chat mode (requires bun)
  relays chat [args...]     Same as above
  relays help               Show this help
  relays settings           Provider/settings wizard (Node)
  relays banner             Show RelayOS banner (Node)
  relays status             Overseer runtime status (Node)
  relays doctor             Overseer health checks (Node)
  relays report             Runtime + handoff report (Node)
  relays run <handoff_id>   Execute one recorded handoff (Node)

Unknown commands are forwarded to: relayos <command> [args...]
EOF
}

# Default + `chat` route to the new RTUI bundle via bun.
if [ "$#" -eq 0 ]; then
  exec bun "$RTUI_JS"
fi

COMMAND="$1"
case "$COMMAND" in
  chat)
    shift
    exec bun "$RTUI_JS" "$@"
    ;;
  help|-h|--help)
    print_help
    exit 0
    ;;
  settings)
    shift
    exec node "$CLI_JS" settings "$@"
    ;;
  banner)
    shift
    exec node "$CLI_JS" banner "$@"
    ;;
  status)
    shift
    exec node "$CLI_JS" overseer status "$@"
    ;;
  doctor)
    shift
    exec node "$CLI_JS" overseer doctor "$@"
    ;;
  report)
    shift
    exec node "$CLI_JS" report "$@"
    ;;
  run)
    shift
    exec node "$CLI_JS" overseer execute-handoff "$@"
    ;;
  *)
    exec node "$CLI_JS" "$@"
    ;;
esac
```

- [ ] **Step 2: Confirm execute bit is still set**

Run:
```bash
ls -l /Users/randy/GID/bin/relays
```
Expected: shows `-rwxr-xr-x` (execute bit set). If not:
```bash
chmod +x /Users/randy/GID/bin/relays
```

- [ ] **Step 3: Try running through the shortcut**

From any directory (assumes `bin/relays` is on PATH or run by absolute path):
```bash
/Users/randy/GID/bin/relays
```
Expected: same TUI you saw in Task 18 Step 2.

```bash
/Users/randy/GID/bin/relays help
```
Expected: prints the help text above.

```bash
/Users/randy/GID/bin/relays banner
```
Expected: existing Node CLI banner output (no change to this path).

- [ ] **Step 4: Commit**

Run:
```bash
cd /Users/randy/GID && git add bin/relays
cd /Users/randy/GID && git commit -m "Route relays chat through dist/rtui.js (bun runtime)"
```

---

## Task 20: Update .gitignore to exclude sample2/ and samplecode/

**Why:** Sample2 is leaked Anthropic source (~2,000 files). Currently untracked but visible to `git status`. Pre-emptively exclude so it can never be accidentally added to a commit or push.

**Files:**
- Modify: `/Users/randy/GID/.gitignore`

- [ ] **Step 1: Inspect current .gitignore**

Run:
```bash
cd /Users/randy/GID && cat .gitignore
```
Note what's already present.

- [ ] **Step 2: Append exclusions**

Run:
```bash
cd /Users/randy/GID && printf "\n# Leaked Anthropic source - reference only, never commit\nsample2/\nsamplecode/\nSAMPLE2_SAMPLECODE_GUIDE.md\n" >> .gitignore
```

- [ ] **Step 3: Verify the directories are now ignored**

Run:
```bash
cd /Users/randy/GID && git status --short sample2 samplecode 2>&1
```
Expected: no output (ignored). If still listed, double-check the lines were appended.

- [ ] **Step 4: Commit**

Run:
```bash
cd /Users/randy/GID && git add .gitignore
cd /Users/randy/GID && git commit -m "Ignore sample2/ and samplecode/ (leaked reference, do not commit)"
```

---

## Task 21: Update CLAUDE.md pointer (if it exists)

**Files:**
- Modify: `/Users/randy/GID/CLAUDE.md` (only if it exists)

- [ ] **Step 1: Check if CLAUDE.md exists at repo root**

Run:
```bash
cd /Users/randy/GID && ls CLAUDE.md 2>/dev/null
```
- If the file does **not** exist, **skip the rest of this task.** Don't create a new top-level CLAUDE.md; the repo doesn't have one today and creating one is a separate decision.
- If it exists, continue to Step 2.

- [ ] **Step 2: Append RTUI pointer**

Append to `/Users/randy/GID/CLAUDE.md`:
```markdown

## RTUI

When work touches anything under `src/rtui/`, read `src/rtui/AGENTS.md`
first — it has the architecture summary, file index, and recipes.

Spec: `docs/superpowers/specs/2026-05-17-rtui-design.md`
Plan: `docs/superpowers/plans/2026-05-17-rtui-phase0-foundation.md`
```

- [ ] **Step 3: Commit**

Run:
```bash
cd /Users/randy/GID && git add CLAUDE.md
cd /Users/randy/GID && git commit -m "Point CLAUDE.md at RTUI AGENTS doc"
```

---

## Task 22: Full Phase 0 verification

**Files:** (none — pure verification)

- [ ] **Step 1: Run the whole test suite**

Run:
```bash
cd /Users/randy/GID && bun test src/rtui/
```
Expected: every RTUI test passes (~32+ tests across all files).

- [ ] **Step 2: Type-check the project**

Run:
```bash
cd /Users/randy/GID && bun x tsc --noEmit
```
Expected: zero errors. (If errors appear from existing non-RTUI files unrelated to this work, that's pre-existing and not Phase 0's job to fix.)

- [ ] **Step 3: Re-build the bundle**

Run:
```bash
cd /Users/randy/GID && bun run build:rtui
```
Expected: clean build, no warnings.

- [ ] **Step 4: Interactive smoke**

Run:
```bash
/Users/randy/GID/bin/relays
```
Test these manually:
1. Prompt `❯` appears, status line shows the current branch.
2. Type `hello`, Enter → see `❯ hello` and `echo: hello` in scrollback.
3. Type `another`, Enter → see both prior items still in scrollback, plus the new pair.
4. Press `↑` → input fills with `another`.
5. Press `↑` again → input fills with `hello`.
6. Press `Ctrl+C` → clean exit, terminal returns to prompt.

- [ ] **Step 5: Non-TTY smoke**

Run:
```bash
echo "piped" | /Users/randy/GID/bin/relays
```
Expected output:
```
❯ piped
echo: piped
```

- [ ] **Step 6: Verify non-chat commands still work**

Run:
```bash
/Users/randy/GID/bin/relays help
/Users/randy/GID/bin/relays banner
```
Expected: both produce their existing Node-CLI output. If `relays banner` errors, the existing `dist/cli.js` may need a rebuild (`npm run build`) — that's unrelated to Phase 0 but worth noting.

- [ ] **Step 7: Final commit checkpoint (no-op if nothing changed)**

Run:
```bash
cd /Users/randy/GID && git status --short
```
Expected: clean tree (except for any pre-existing modifications to `src/chat.ts`, etc., that were present before this plan started — those are explicitly out of scope).

---

## Done criteria for Phase 0

✅ `bun --version` succeeds.
✅ `bun test src/rtui/` is green.
✅ `bun run build:rtui` produces `dist/rtui.js`.
✅ `relays` (no args) opens an Ink TUI you can type into.
✅ Typing free text + Enter shows `❯ <text>` and `echo: <text>` in scrollback.
✅ `Ctrl+C` exits cleanly.
✅ `relays help` and other non-chat subcommands still work via Node.
✅ `sample2/` is gitignored and not tracked.

## What you should NOT see at end of Phase 0

❌ Slash palette overlay (Phase 1).
❌ `/help`, `/exit`, `/tasks`, `/status` commands (Phase 1+).
❌ Real AI responses (Phase 3).
❌ Settings wizard inside the TUI (Phase 5).
❌ `src/chat.ts` deletion (Phase 6).

## Next plan

After Phase 0 ships, write `docs/superpowers/plans/<date>-rtui-phase1-overlays.md` covering OverlayHost, SlashPalette, useKeybindings, slashRouter, `/help`, `/exit`.
