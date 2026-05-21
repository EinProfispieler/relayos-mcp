# RTUI Phase 1: Slash Palette + Welcome Banner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Codex-style welcome banner and a `/`-triggered command palette to the RTUI, with a read-only Node CLI bridge that streams `dist/cli.js overseer ...` output into scrollback.

**Architecture:** Extends the Phase 0 single-store reducer with `palette` and `cli` slices. New components mount inside the existing `Shell` (`WelcomeBanner` once at top of `<Static>`, `SlashPalette` absolute-positioned when visible). `runCliCommand` spawns `process.execPath dist/cli.js <argv>` and dispatches output lines.

**Tech Stack:** React 19 + Ink 7, `bun:test` + `ink-testing-library`, `child_process.spawn`, TypeScript with `.js` import extensions.

**Spec:** `docs/superpowers/specs/2026-05-17-rtui-phase1-overlays.md`

**Convention note:** Phase 0 placed UI components in `src/rtui/screens/` (not `components/`). Phase 1 follows the same convention. The hook goes in a new `src/rtui/hooks/` folder. The CLI bridge goes in a new `src/rtui/commands/` folder.

---

## File Structure

**Create:**
- `src/rtui/commands/registry.ts` — command list (single source of truth)
- `src/rtui/commands/registry.test.ts`
- `src/rtui/commands/runner.ts` — spawn + dispatch CLI output
- `src/rtui/commands/runner.test.ts`
- `src/rtui/hooks/useSlashOverlay.ts` — palette state hook
- `src/rtui/hooks/useSlashOverlay.test.tsx`
- `src/rtui/screens/SlashPalette.tsx`
- `src/rtui/screens/SlashPalette.test.tsx`
- `src/rtui/screens/WelcomeBanner.tsx`
- `src/rtui/screens/WelcomeBanner.test.tsx`

**Modify:**
- `src/rtui/state/types.ts` — add `PaletteState`, `CliState`, new action variants
- `src/rtui/state/store.ts` — handle new actions (initial state + reducer cases)
- `src/rtui/state/store.test.ts` — cover new actions
- `src/rtui/screens/InputRow.tsx` — detect leading `/`, mirror to palette query, gate `useInput`
- `src/rtui/screens/InputRow.test.tsx` — cover slash detection
- `src/rtui/Shell.tsx` — mount `WelcomeBanner` once and `SlashPalette` when visible

---

### Task 1: Add palette + cli state types and actions

**Files:**
- Modify: `src/rtui/state/types.ts`

- [ ] **Step 1: Add `PaletteState` and `CliState` interfaces**

Insert after the existing `InputState` interface in `src/rtui/state/types.ts`:

```ts
export interface PaletteState {
  visible: boolean;
  query: string;
  selectedIndex: number;
}

export interface CliCommandRef {
  commandName: string;
  argv: readonly string[];
}

export interface CliState {
  running: CliCommandRef | null;
  queue: readonly CliCommandRef[];
  streamingLines: readonly string[];
}
```

- [ ] **Step 2: Extend `RTUIState` with the new slices**

Replace the `RTUIState` interface with:

```ts
export interface RTUIState {
  session: SessionInfo;
  runtime: RuntimeView;
  scrollback: ScrollbackItem[];
  live: LiveState;
  input: InputState;
  status: Status;
  palette: PaletteState;
  cli: CliState;
}
```

- [ ] **Step 3: Add new action variants**

Replace the `RTUIAction` union with:

```ts
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
  | { type: "RUNTIME_UPDATED"; runtime: RuntimeView }
  | { type: "SLASH_OPEN" }
  | { type: "SLASH_QUERY"; query: string }
  | { type: "SLASH_CLOSE" }
  | { type: "SLASH_MOVE"; delta: number; visibleCount: number }
  | { type: "SLASH_SELECT" }
  | { type: "CLI_COMMAND_START"; commandName: string; argv: readonly string[] }
  | { type: "CLI_COMMAND_QUEUE"; commandName: string; argv: readonly string[] }
  | { type: "CLI_OUTPUT_LINE"; line: string }
  | { type: "CLI_COMMAND_COMPLETE"; exitCode: number };
```

Note: `SLASH_MOVE` carries `visibleCount` so the reducer can clamp `selectedIndex` without knowing the registry.

- [ ] **Step 4: Run typecheck**

Run: `bun x tsc --noEmit`
Expected: FAIL — store.ts now needs to initialize the new slices and handle the new actions.

- [ ] **Step 5: Commit**

```bash
git add src/rtui/state/types.ts
git commit -m "RTUI Phase 1: add palette + cli state types and actions"
```

---

### Task 2: Reducer support for palette actions

**Files:**
- Modify: `src/rtui/state/store.ts`, `src/rtui/state/store.test.ts`

- [ ] **Step 1: Write failing tests for palette actions**

Append to `src/rtui/state/store.test.ts`:

```ts
test("SLASH_OPEN sets palette visible with empty query", () => {
  const s = reducer(initialState(runtime), { type: "SLASH_OPEN" });
  expect(s.palette.visible).toBe(true);
  expect(s.palette.query).toBe("");
  expect(s.palette.selectedIndex).toBe(0);
});

test("SLASH_QUERY updates query and resets selectedIndex", () => {
  let s = reducer(initialState(runtime), { type: "SLASH_OPEN" });
  s = reducer(s, { type: "SLASH_MOVE", delta: 2, visibleCount: 5 });
  s = reducer(s, { type: "SLASH_QUERY", query: "/st" });
  expect(s.palette.query).toBe("/st");
  expect(s.palette.selectedIndex).toBe(0);
});

test("SLASH_MOVE clamps selectedIndex within [0, visibleCount-1]", () => {
  let s = reducer(initialState(runtime), { type: "SLASH_OPEN" });
  s = reducer(s, { type: "SLASH_MOVE", delta: 10, visibleCount: 3 });
  expect(s.palette.selectedIndex).toBe(2);
  s = reducer(s, { type: "SLASH_MOVE", delta: -10, visibleCount: 3 });
  expect(s.palette.selectedIndex).toBe(0);
});

test("SLASH_MOVE with visibleCount 0 keeps selectedIndex at 0", () => {
  let s = reducer(initialState(runtime), { type: "SLASH_OPEN" });
  s = reducer(s, { type: "SLASH_MOVE", delta: 1, visibleCount: 0 });
  expect(s.palette.selectedIndex).toBe(0);
});

test("SLASH_CLOSE hides palette and resets query", () => {
  let s = reducer(initialState(runtime), { type: "SLASH_OPEN" });
  s = reducer(s, { type: "SLASH_QUERY", query: "/he" });
  s = reducer(s, { type: "SLASH_CLOSE" });
  expect(s.palette.visible).toBe(false);
  expect(s.palette.query).toBe("");
  expect(s.palette.selectedIndex).toBe(0);
});
```

The existing test file imports `initialState`, `reducer`, and references a `runtime` constant — reuse the same imports/fixtures. If the file doesn't already define `runtime`, add at the top:

```ts
import type { RuntimeView } from "./types.js";

const runtime: RuntimeView = {
  projectDir: "test",
  branch: "main",
  model: "stub",
  effort: "medium",
  isGitRepo: true,
};
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/rtui/state/store.test.ts`
Expected: FAIL — palette slice doesn't exist in initial state, reducer cases missing.

- [ ] **Step 3: Initialize palette + cli slices in `initialState`**

In `src/rtui/state/store.ts`, update the `initialState` return:

```ts
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
    palette: { visible: false, query: "", selectedIndex: 0 },
    cli: { running: null, queue: [], streamingLines: [] },
  };
}
```

- [ ] **Step 4: Add palette reducer cases**

Insert these `case` blocks before the `default` block in `reducer`:

```ts
case "SLASH_OPEN":
  return {
    ...state,
    palette: { visible: true, query: "", selectedIndex: 0 },
  };

case "SLASH_QUERY":
  return {
    ...state,
    palette: { ...state.palette, query: action.query, selectedIndex: 0 },
  };

case "SLASH_CLOSE":
  return {
    ...state,
    palette: { visible: false, query: "", selectedIndex: 0 },
  };

case "SLASH_MOVE": {
  if (action.visibleCount <= 0) {
    return { ...state, palette: { ...state.palette, selectedIndex: 0 } };
  }
  const next = Math.max(
    0,
    Math.min(action.visibleCount - 1, state.palette.selectedIndex + action.delta),
  );
  return { ...state, palette: { ...state.palette, selectedIndex: next } };
}

case "SLASH_SELECT":
  return state;
```

`SLASH_SELECT` is a no-op in the reducer — selection side-effects (running a CLI command, closing palette, etc.) happen in the UI layer that dispatched it.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/rtui/state/store.test.ts`
Expected: PASS — all palette tests green, plus the pre-existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/rtui/state/store.ts src/rtui/state/store.test.ts
git commit -m "RTUI Phase 1: reducer support for palette actions"
```

---

### Task 3: Reducer support for CLI actions

**Files:**
- Modify: `src/rtui/state/store.ts`, `src/rtui/state/store.test.ts`

- [ ] **Step 1: Write failing tests for cli actions**

Append to `src/rtui/state/store.test.ts`:

```ts
test("CLI_COMMAND_START sets running and clears streamingLines", () => {
  const s = reducer(initialState(runtime), {
    type: "CLI_COMMAND_START",
    commandName: "/status",
    argv: ["overseer", "status"],
  });
  expect(s.cli.running).toEqual({ commandName: "/status", argv: ["overseer", "status"] });
  expect(s.cli.streamingLines).toEqual([]);
});

test("CLI_COMMAND_QUEUE appends to queue when something is running", () => {
  let s = reducer(initialState(runtime), {
    type: "CLI_COMMAND_START",
    commandName: "/status",
    argv: ["overseer", "status"],
  });
  s = reducer(s, {
    type: "CLI_COMMAND_QUEUE",
    commandName: "/recent",
    argv: ["overseer", "recent"],
  });
  expect(s.cli.queue).toHaveLength(1);
  expect(s.cli.queue[0]?.commandName).toBe("/recent");
});

test("CLI_OUTPUT_LINE appends a line to streamingLines", () => {
  let s = reducer(initialState(runtime), {
    type: "CLI_COMMAND_START",
    commandName: "/status",
    argv: ["overseer", "status"],
  });
  s = reducer(s, { type: "CLI_OUTPUT_LINE", line: "hello" });
  s = reducer(s, { type: "CLI_OUTPUT_LINE", line: "world" });
  expect(s.cli.streamingLines).toEqual(["hello", "world"]);
});

test("CLI_COMMAND_COMPLETE flushes streamingLines into scrollback and clears running", () => {
  let s = reducer(initialState(runtime), {
    type: "CLI_COMMAND_START",
    commandName: "/status",
    argv: ["overseer", "status"],
  });
  s = reducer(s, { type: "CLI_OUTPUT_LINE", line: "line A" });
  s = reducer(s, { type: "CLI_OUTPUT_LINE", line: "line B" });
  s = reducer(s, { type: "CLI_COMMAND_COMPLETE", exitCode: 0 });
  expect(s.cli.running).toBeNull();
  expect(s.cli.streamingLines).toEqual([]);
  const lastTwo = s.scrollback.slice(-2);
  expect(lastTwo[0]).toMatchObject({ type: "system_note", text: expect.stringContaining("line A") });
  expect(lastTwo[1]).toMatchObject({ type: "system_note", text: expect.stringContaining("line B") });
});

test("CLI_COMMAND_COMPLETE with non-zero exitCode appends an error note", () => {
  let s = reducer(initialState(runtime), {
    type: "CLI_COMMAND_START",
    commandName: "/status",
    argv: ["overseer", "status"],
  });
  s = reducer(s, { type: "CLI_COMMAND_COMPLETE", exitCode: 2 });
  const last = s.scrollback[s.scrollback.length - 1];
  expect(last).toMatchObject({ type: "error", text: expect.stringContaining("exit 2") });
});

test("CLI_COMMAND_COMPLETE promotes next queued command into running", () => {
  let s = reducer(initialState(runtime), {
    type: "CLI_COMMAND_START",
    commandName: "/status",
    argv: ["overseer", "status"],
  });
  s = reducer(s, {
    type: "CLI_COMMAND_QUEUE",
    commandName: "/recent",
    argv: ["overseer", "recent"],
  });
  s = reducer(s, { type: "CLI_COMMAND_COMPLETE", exitCode: 0 });
  expect(s.cli.running).toEqual({ commandName: "/recent", argv: ["overseer", "recent"] });
  expect(s.cli.queue).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/rtui/state/store.test.ts`
Expected: FAIL — cli reducer cases missing.

- [ ] **Step 3: Add a small id helper in store.ts**

Add near the top of `src/rtui/state/store.ts` (after `newSessionId`):

```ts
function newItemId(): string {
  return `cli-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
```

- [ ] **Step 4: Add cli reducer cases**

Insert before the `default` block in `reducer`:

```ts
case "CLI_COMMAND_START":
  return {
    ...state,
    cli: {
      running: { commandName: action.commandName, argv: action.argv },
      queue: state.cli.queue,
      streamingLines: [],
    },
  };

case "CLI_COMMAND_QUEUE":
  return {
    ...state,
    cli: {
      ...state.cli,
      queue: [...state.cli.queue, { commandName: action.commandName, argv: action.argv }],
    },
  };

case "CLI_OUTPUT_LINE":
  return {
    ...state,
    cli: { ...state.cli, streamingLines: [...state.cli.streamingLines, action.line] },
  };

case "CLI_COMMAND_COMPLETE": {
  const flushed: ScrollbackItem[] = state.cli.streamingLines.map((line) => ({
    id: newItemId(),
    type: "system_note" as const,
    text: line,
  }));
  if (action.exitCode !== 0) {
    flushed.push({
      id: newItemId(),
      type: "error" as const,
      text: `(exit ${action.exitCode})`,
    });
  }
  const [nextRunning, ...restQueue] = state.cli.queue;
  return {
    ...state,
    scrollback: [...state.scrollback, ...flushed],
    cli: {
      running: nextRunning ?? null,
      queue: restQueue,
      streamingLines: [],
    },
  };
}
```

Make sure `ScrollbackItem` is imported at the top of `store.ts`:

```ts
import type { RTUIAction, RTUIState, RuntimeView, ScrollbackItem } from "./types.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/rtui/state/store.test.ts`
Expected: PASS — all cli tests green.

- [ ] **Step 6: Run full typecheck**

Run: `bun x tsc --noEmit`
Expected: PASS — exhaustive `never` check satisfied.

- [ ] **Step 7: Commit**

```bash
git add src/rtui/state/store.ts src/rtui/state/store.test.ts
git commit -m "RTUI Phase 1: reducer support for CLI command lifecycle"
```

---

### Task 4: Slash command registry

**Files:**
- Create: `src/rtui/commands/registry.ts`, `src/rtui/commands/registry.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/rtui/commands/registry.test.ts`:

```ts
import { test, expect } from "bun:test";
import { SLASH_COMMANDS, filterCommands, isSelectable } from "./registry.js";

test("registry has expected command names in declared order", () => {
  expect(SLASH_COMMANDS.map((c) => c.name)).toEqual([
    "/help",
    "/status",
    "/recent",
    "/next",
    "/results",
    "/settings",
    "/exit",
    "/approve",
    "/run",
  ]);
});

test("each cli command has argv; disabled commands do not", () => {
  for (const c of SLASH_COMMANDS) {
    if (c.kind === "cli") expect(c.argv && c.argv.length > 0).toBe(true);
    if (c.kind === "disabled") expect(c.argv).toBeUndefined();
  }
});

test("no duplicate command names", () => {
  const names = SLASH_COMMANDS.map((c) => c.name);
  expect(new Set(names).size).toBe(names.length);
});

test("filterCommands matches by prefix on the substring after /", () => {
  expect(filterCommands("/").map((c) => c.name)).toEqual(SLASH_COMMANDS.map((c) => c.name));
  expect(filterCommands("/he").map((c) => c.name)).toEqual(["/help"]);
  expect(filterCommands("/r").map((c) => c.name)).toEqual(["/recent", "/results", "/run"]);
  expect(filterCommands("/zzz")).toEqual([]);
});

test("filterCommands is case-insensitive", () => {
  expect(filterCommands("/HE").map((c) => c.name)).toEqual(["/help"]);
});

test("isSelectable returns false for disabled commands", () => {
  const approve = SLASH_COMMANDS.find((c) => c.name === "/approve");
  expect(approve).toBeDefined();
  expect(isSelectable(approve!)).toBe(false);
  const help = SLASH_COMMANDS.find((c) => c.name === "/help");
  expect(isSelectable(help!)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `bun test src/rtui/commands/registry.test.ts`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Implement the registry**

Create `src/rtui/commands/registry.ts`:

```ts
export type CommandKind = "local" | "cli" | "disabled";

export type LocalHandlerName = "help" | "exit";

export interface SlashCommand {
  name: string;
  description: string;
  kind: CommandKind;
  argv?: readonly string[];
  localHandler?: LocalHandlerName;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: "/help",     description: "Show available commands",    kind: "local",    localHandler: "help" },
  { name: "/status",   description: "Overseer runtime status",    kind: "cli",      argv: ["overseer", "status"] },
  { name: "/recent",   description: "Recent activity",            kind: "cli",      argv: ["overseer", "recent"] },
  { name: "/next",     description: "Next recommended action",    kind: "cli",      argv: ["overseer", "next"] },
  { name: "/results",  description: "Completed handoff results",  kind: "cli",      argv: ["overseer", "handoff-results"] },
  { name: "/settings", description: "Open settings wizard",       kind: "cli",      argv: ["settings"] },
  { name: "/exit",     description: "Quit RTUI",                  kind: "local",    localHandler: "exit" },
  { name: "/approve",  description: "Approve handoff (coming soon)", kind: "disabled" },
  { name: "/run",      description: "Execute handoff (coming soon)", kind: "disabled" },
];

export function filterCommands(query: string): readonly SlashCommand[] {
  const trimmed = query.startsWith("/") ? query.slice(1) : query;
  const needle = trimmed.toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.name.slice(1).toLowerCase().startsWith(needle));
}

export function isSelectable(cmd: SlashCommand): boolean {
  return cmd.kind !== "disabled";
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `bun test src/rtui/commands/registry.test.ts`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/rtui/commands/registry.ts src/rtui/commands/registry.test.ts
git commit -m "RTUI Phase 1: slash command registry"
```

---

### Task 5: CLI runner (spawn + dispatch)

**Files:**
- Create: `src/rtui/commands/runner.ts`, `src/rtui/commands/runner.test.ts`

- [ ] **Step 1: Write failing test using a mock spawner**

Create `src/rtui/commands/runner.test.ts`:

```ts
import { test, expect, mock } from "bun:test";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { runCliCommand, type CliSpawner } from "./runner.js";
import type { RTUIAction } from "../state/types.js";

function makeFakeChild(stdoutChunks: string[], exitCode = 0) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: Readable;
    stderr: Readable;
  };
  child.stdout = Readable.from(stdoutChunks);
  child.stderr = Readable.from([]);
  queueMicrotask(() => {
    setTimeout(() => child.emit("exit", exitCode), 5);
  });
  return child;
}

test("runCliCommand dispatches START, OUTPUT lines, then COMPLETE", async () => {
  const dispatched: RTUIAction[] = [];
  const dispatch = (a: RTUIAction) => { dispatched.push(a); };
  const spawn: CliSpawner = mock(() => makeFakeChild(["alpha\nbeta\n"], 0)) as unknown as CliSpawner;

  await runCliCommand({
    commandName: "/status",
    argv: ["overseer", "status"],
    dispatch,
    spawn,
  });

  expect(dispatched[0]).toMatchObject({ type: "CLI_COMMAND_START", commandName: "/status" });
  const outputs = dispatched.filter((a) => a.type === "CLI_OUTPUT_LINE");
  expect(outputs.map((o) => (o as { line: string }).line)).toEqual(["alpha", "beta"]);
  expect(dispatched[dispatched.length - 1]).toMatchObject({
    type: "CLI_COMMAND_COMPLETE",
    exitCode: 0,
  });
});

test("runCliCommand prefixes stderr lines", async () => {
  const dispatched: RTUIAction[] = [];
  const dispatch = (a: RTUIAction) => { dispatched.push(a); };
  const child = new EventEmitter() as EventEmitter & { stdout: Readable; stderr: Readable };
  child.stdout = Readable.from([]);
  child.stderr = Readable.from(["boom\n"]);
  queueMicrotask(() => setTimeout(() => child.emit("exit", 1), 5));
  const spawn: CliSpawner = mock(() => child) as unknown as CliSpawner;

  await runCliCommand({
    commandName: "/status",
    argv: ["overseer", "status"],
    dispatch,
    spawn,
  });

  const outputs = dispatched.filter((a) => a.type === "CLI_OUTPUT_LINE");
  expect(outputs.map((o) => (o as { line: string }).line)).toEqual(["[stderr] boom"]);
  expect(dispatched[dispatched.length - 1]).toMatchObject({
    type: "CLI_COMMAND_COMPLETE",
    exitCode: 1,
  });
});

test("runCliCommand dispatches an error line and exitCode -1 when spawn throws", async () => {
  const dispatched: RTUIAction[] = [];
  const dispatch = (a: RTUIAction) => { dispatched.push(a); };
  const spawn: CliSpawner = (() => {
    throw new Error("ENOENT");
  }) as unknown as CliSpawner;

  await runCliCommand({
    commandName: "/status",
    argv: ["overseer", "status"],
    dispatch,
    spawn,
  });

  const outputs = dispatched.filter((a) => a.type === "CLI_OUTPUT_LINE");
  expect(outputs.map((o) => (o as { line: string }).line).join(" ")).toContain("ENOENT");
  expect(dispatched[dispatched.length - 1]).toMatchObject({
    type: "CLI_COMMAND_COMPLETE",
    exitCode: -1,
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `bun test src/rtui/commands/runner.test.ts`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Implement the runner**

Create `src/rtui/commands/runner.ts`:

```ts
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { RTUIAction } from "../state/types.js";

export type CliSpawner = (
  command: string,
  args: readonly string[],
  options: { stdio: ["ignore", "pipe", "pipe"] },
) => ChildProcess;

export interface RunCliCommandOptions {
  commandName: string;
  argv: readonly string[];
  dispatch: (action: RTUIAction) => void;
  spawn?: CliSpawner;
  cliJsPath?: string;
  nodeBin?: string;
}

const DEFAULT_CLI_JS_PATH = fileURLToPath(new URL("../../../dist/cli.js", import.meta.url));

export async function runCliCommand(opts: RunCliCommandOptions): Promise<void> {
  const {
    commandName,
    argv,
    dispatch,
    spawn = nodeSpawn as unknown as CliSpawner,
    cliJsPath = DEFAULT_CLI_JS_PATH,
    nodeBin = process.execPath,
  } = opts;

  dispatch({ type: "CLI_COMMAND_START", commandName, argv });

  let child: ChildProcess;
  try {
    child = spawn(nodeBin, [cliJsPath, ...argv], { stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    dispatch({ type: "CLI_OUTPUT_LINE", line: `error: ${msg}` });
    dispatch({ type: "CLI_COMMAND_COMPLETE", exitCode: -1 });
    return;
  }

  const drain = (stream: NodeJS.ReadableStream | null, prefix: string) => {
    return new Promise<void>((resolve) => {
      if (!stream) { resolve(); return; }
      let buf = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        buf += chunk;
        let idx: number;
        while ((idx = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          dispatch({ type: "CLI_OUTPUT_LINE", line: prefix + line });
        }
      });
      stream.on("end", () => {
        if (buf.length > 0) dispatch({ type: "CLI_OUTPUT_LINE", line: prefix + buf });
        resolve();
      });
      stream.on("error", () => resolve());
    });
  };

  const exited = new Promise<number>((resolve) => {
    child.on("exit", (code) => resolve(code ?? 0));
    child.on("error", () => resolve(-1));
  });

  await Promise.all([
    drain(child.stdout, ""),
    drain(child.stderr, "[stderr] "),
    exited,
  ]);

  const exitCode = await exited;
  dispatch({ type: "CLI_COMMAND_COMPLETE", exitCode });
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `bun test src/rtui/commands/runner.test.ts`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/rtui/commands/runner.ts src/rtui/commands/runner.test.ts
git commit -m "RTUI Phase 1: CLI runner with mockable spawn"
```

---

### Task 6: `useSlashOverlay` hook

**Files:**
- Create: `src/rtui/hooks/useSlashOverlay.ts`, `src/rtui/hooks/useSlashOverlay.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/rtui/hooks/useSlashOverlay.test.tsx`:

```tsx
import { test, expect } from "bun:test";
import { Text, useApp } from "ink";
import { render } from "ink-testing-library";
import { useEffect } from "react";
import { RTUIProvider, useRTUI } from "../state/context.js";
import { useSlashOverlay } from "./useSlashOverlay.js";
import type { RuntimeView } from "../state/types.js";

const runtime: RuntimeView = {
  projectDir: "test",
  branch: "main",
  model: "stub",
  effort: "medium",
  isGitRepo: true,
};

function Probe({ trigger }: { trigger: (api: ReturnType<typeof useSlashOverlay>) => void }) {
  const api = useSlashOverlay();
  const { state } = useRTUI();
  useEffect(() => { trigger(api); }, []);
  const names = api.filtered.map((c) => c.name).join(",");
  return <Text>{`visible=${state.palette.visible} sel=${state.palette.selectedIndex} names=${names}`}</Text>;
}

test("open() shows full registry and visible=true", async () => {
  const { lastFrame } = render(
    <RTUIProvider runtime={runtime}>
      <Probe trigger={(api) => api.open()} />
    </RTUIProvider>,
  );
  await new Promise((r) => setTimeout(r, 5));
  expect(lastFrame()).toContain("visible=true");
  expect(lastFrame()).toContain("/help");
  expect(lastFrame()).toContain("/exit");
});

test("setQuery filters and move() clamps", async () => {
  const { lastFrame, rerender } = render(
    <RTUIProvider runtime={runtime}>
      <Probe trigger={(api) => { api.open(); api.setQuery("/r"); api.move(10); }} />
    </RTUIProvider>,
  );
  await new Promise((r) => setTimeout(r, 5));
  // /r matches /recent /results /run → 3 items, last index 2
  expect(lastFrame()).toContain("names=/recent,/results,/run");
  expect(lastFrame()).toContain("sel=2");
  rerender(
    <RTUIProvider runtime={runtime}>
      <Probe trigger={(api) => { api.open(); api.setQuery("/r"); api.move(10); api.close(); }} />
    </RTUIProvider>,
  );
  await new Promise((r) => setTimeout(r, 5));
  expect(lastFrame()).toContain("visible=false");
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `bun test src/rtui/hooks/useSlashOverlay.test.tsx`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Implement the hook**

Create `src/rtui/hooks/useSlashOverlay.ts`:

```ts
import { useMemo } from "react";
import { useRTUI } from "../state/context.js";
import { filterCommands, isSelectable, type SlashCommand } from "../commands/registry.js";

export interface SlashOverlayApi {
  visible: boolean;
  query: string;
  filtered: readonly SlashCommand[];
  selectedIndex: number;
  selectableCount: number;
  open: () => void;
  close: () => void;
  setQuery: (query: string) => void;
  move: (delta: number) => void;
  select: () => SlashCommand | null;
}

export function useSlashOverlay(): SlashOverlayApi {
  const { state, dispatch } = useRTUI();
  const { palette } = state;
  const filtered = useMemo(() => filterCommands(palette.query), [palette.query]);

  return {
    visible: palette.visible,
    query: palette.query,
    filtered,
    selectedIndex: Math.min(palette.selectedIndex, Math.max(0, filtered.length - 1)),
    selectableCount: filtered.filter(isSelectable).length,
    open: () => dispatch({ type: "SLASH_OPEN" }),
    close: () => dispatch({ type: "SLASH_CLOSE" }),
    setQuery: (query: string) => dispatch({ type: "SLASH_QUERY", query }),
    move: (delta: number) =>
      dispatch({ type: "SLASH_MOVE", delta, visibleCount: filtered.length }),
    select: () => {
      const cmd = filtered[Math.min(palette.selectedIndex, filtered.length - 1)];
      if (!cmd || !isSelectable(cmd)) return null;
      return cmd;
    },
  };
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `bun test src/rtui/hooks/useSlashOverlay.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rtui/hooks/useSlashOverlay.ts src/rtui/hooks/useSlashOverlay.test.tsx
git commit -m "RTUI Phase 1: useSlashOverlay hook"
```

---

### Task 7: `SlashPalette` component

**Files:**
- Create: `src/rtui/screens/SlashPalette.tsx`, `src/rtui/screens/SlashPalette.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/rtui/screens/SlashPalette.test.tsx`:

```tsx
import { test, expect } from "bun:test";
import { render } from "ink-testing-library";
import { useEffect } from "react";
import { RTUIProvider } from "../state/context.js";
import { useRTUI } from "../state/context.js";
import { SlashPalette } from "./SlashPalette.js";
import type { RuntimeView } from "../state/types.js";

const runtime: RuntimeView = {
  projectDir: "t",
  branch: "main",
  model: "s",
  effort: "medium",
  isGitRepo: true,
};

function Seed({ query, sel }: { query: string; sel: number }) {
  const { dispatch } = useRTUI();
  useEffect(() => {
    dispatch({ type: "SLASH_OPEN" });
    dispatch({ type: "SLASH_QUERY", query });
    for (let i = 0; i < sel; i++) {
      dispatch({ type: "SLASH_MOVE", delta: 1, visibleCount: 99 });
    }
  }, [query, sel, dispatch]);
  return null;
}

test("renders matching commands with descriptions", () => {
  const { lastFrame } = render(
    <RTUIProvider runtime={runtime}>
      <Seed query="/r" sel={0} />
      <SlashPalette />
    </RTUIProvider>,
  );
  const frame = lastFrame() ?? "";
  expect(frame).toContain("/recent");
  expect(frame).toContain("/results");
  expect(frame).toContain("/run");
  expect(frame).toContain("coming soon");
});

test("hidden when palette.visible is false", () => {
  const { lastFrame } = render(
    <RTUIProvider runtime={runtime}>
      <SlashPalette />
    </RTUIProvider>,
  );
  expect(lastFrame() ?? "").toBe("");
});

test("renders empty-state when filter matches nothing", () => {
  const { lastFrame } = render(
    <RTUIProvider runtime={runtime}>
      <Seed query="/zzz" sel={0} />
      <SlashPalette />
    </RTUIProvider>,
  );
  expect(lastFrame() ?? "").toContain("no matching commands");
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `bun test src/rtui/screens/SlashPalette.test.tsx`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Implement the component**

Create `src/rtui/screens/SlashPalette.tsx`:

```tsx
import { Box, Text } from "ink";
import { useSlashOverlay } from "../hooks/useSlashOverlay.js";
import { isSelectable } from "../commands/registry.js";

export function SlashPalette() {
  const { visible, filtered, selectedIndex } = useSlashOverlay();
  if (!visible) return null;
  if (filtered.length === 0) {
    return (
      <Box borderStyle="round" paddingX={1}>
        <Text dimColor>no matching commands</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      {filtered.map((cmd, idx) => {
        const isSel = idx === selectedIndex;
        const disabled = !isSelectable(cmd);
        const prefix = isSel ? "❯ " : "  ";
        return (
          <Box key={cmd.name}>
            <Text color={isSel && !disabled ? "cyan" : undefined} dimColor={disabled}>
              {prefix}{cmd.name.padEnd(10)}  {cmd.description}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `bun test src/rtui/screens/SlashPalette.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rtui/screens/SlashPalette.tsx src/rtui/screens/SlashPalette.test.tsx
git commit -m "RTUI Phase 1: SlashPalette component"
```

---

### Task 8: `WelcomeBanner` component

**Files:**
- Create: `src/rtui/screens/WelcomeBanner.tsx`, `src/rtui/screens/WelcomeBanner.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/rtui/screens/WelcomeBanner.test.tsx`:

```tsx
import { test, expect } from "bun:test";
import { render } from "ink-testing-library";
import { WelcomeBanner } from "./WelcomeBanner.js";

test("renders banner art, recent activity placeholder, and three tips", () => {
  const { lastFrame } = render(
    <WelcomeBanner recent={[]} />,
  );
  const frame = lastFrame() ?? "";
  expect(frame).toContain("RelayOS");
  expect(frame).toContain("Recent activity");
  expect(frame).toContain("(none)");
  expect(frame).toContain("Type / to open");
  expect(frame).toContain("↑/↓");
  expect(frame).toContain("/help");
});

test("renders provided recent lines (up to 3)", () => {
  const { lastFrame } = render(
    <WelcomeBanner recent={["alpha", "beta", "gamma", "delta"]} />,
  );
  const frame = lastFrame() ?? "";
  expect(frame).toContain("alpha");
  expect(frame).toContain("beta");
  expect(frame).toContain("gamma");
  expect(frame).not.toContain("delta");
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `bun test src/rtui/screens/WelcomeBanner.test.tsx`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Implement the component**

Create `src/rtui/screens/WelcomeBanner.tsx`:

```tsx
import { Box, Text } from "ink";

const WELCOME_BANNER_ART = "RelayOS — chat shell";

const TIPS: readonly string[] = [
  "Type / to open the command palette",
  "Use ↑/↓ to navigate, Return to select, Esc to dismiss",
  "Type /help for the full command list",
];

export interface WelcomeBannerProps {
  recent: readonly string[];
}

export function WelcomeBanner({ recent }: WelcomeBannerProps) {
  const top3 = recent.slice(0, 3);
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>{WELCOME_BANNER_ART}</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Recent activity</Text>
        {top3.length === 0 ? (
          <Text dimColor>  (none)</Text>
        ) : (
          top3.map((line, i) => <Text key={i}>{`  ${line}`}</Text>)
        )}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {TIPS.map((tip, i) => (
          <Text key={i} dimColor>{`  ${tip}`}</Text>
        ))}
      </Box>
    </Box>
  );
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `bun test src/rtui/screens/WelcomeBanner.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rtui/screens/WelcomeBanner.tsx src/rtui/screens/WelcomeBanner.test.tsx
git commit -m "RTUI Phase 1: WelcomeBanner component"
```

---

### Task 9: InputRow slash detection and routing

**Files:**
- Modify: `src/rtui/screens/InputRow.tsx`, `src/rtui/screens/InputRow.test.tsx`

- [ ] **Step 1: Write failing test**

Append to `src/rtui/screens/InputRow.test.tsx`. The most reliable assertion is to render `InputRow` + `SlashPalette` together, type `/`, and check the palette becomes visible:

```tsx
import { test, expect } from "bun:test";
import { render } from "ink-testing-library";
import { RTUIProvider } from "../state/context.js";
import { InputRow } from "./InputRow.js";
import { SlashPalette } from "./SlashPalette.js";
import type { RuntimeView } from "../state/types.js";

const runtime: RuntimeView = {
  projectDir: "t", branch: "main", model: "s", effort: "medium", isGitRepo: true,
};

test("typing / opens the slash palette", async () => {
  const { stdin, lastFrame } = render(
    <RTUIProvider runtime={runtime}>
      <InputRow />
      <SlashPalette />
    </RTUIProvider>,
  );
  stdin.write("/");
  await new Promise((r) => setTimeout(r, 5));
  expect(lastFrame() ?? "").toContain("/help");
});

test("backspacing past leading / closes the palette", async () => {
  const { stdin, lastFrame } = render(
    <RTUIProvider runtime={runtime}>
      <InputRow />
      <SlashPalette />
    </RTUIProvider>,
  );
  stdin.write("/");
  await new Promise((r) => setTimeout(r, 5));
  // Backspace
  stdin.write("");
  await new Promise((r) => setTimeout(r, 5));
  expect(lastFrame() ?? "").not.toContain("/help");
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun test src/rtui/screens/InputRow.test.tsx`
Expected: FAIL — InputRow doesn't dispatch SLASH_OPEN yet.

- [ ] **Step 3: Update `InputRow.tsx` to detect slash and mirror query**

Modify `src/rtui/screens/InputRow.tsx`. Add an import and replace the existing implementation:

```tsx
import { Box, Text, useInput } from "ink";
import { useRTUI } from "../state/context.js";
import { colors } from "../theme/colors.js";

export function InputRow() {
  const { state, dispatch } = useRTUI();
  const { value, cursor } = state.input;
  const paletteVisible = state.palette.visible;

  useInput(
    (char, key) => {
      // When the palette is visible, it owns Return / arrows / Esc.
      // InputRow only handles character typing and backspace so the
      // buffer (and thus the palette query) stays in sync.
      if (paletteVisible && (key.return || key.upArrow || key.downArrow || key.escape || key.leftArrow || key.rightArrow)) {
        return;
      }
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
        const nextCursor = cursor - 1;
        dispatch({ type: "INPUT_CHANGED", value: next, cursor: nextCursor });
        if (paletteVisible) {
          if (!next.startsWith("/")) dispatch({ type: "SLASH_CLOSE" });
          else dispatch({ type: "SLASH_QUERY", query: next });
        }
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
      const nextCursor = cursor + char.length;
      dispatch({ type: "INPUT_CHANGED", value: next, cursor: nextCursor });
      if (!paletteVisible && next === "/") {
        dispatch({ type: "SLASH_OPEN" });
      } else if (paletteVisible && next.startsWith("/")) {
        dispatch({ type: "SLASH_QUERY", query: next });
      }
    },
  );
  // Note: InputRow's useInput is always active. SlashPalette has its own
  // useInput gated by { isActive: visible } that handles arrow keys, Esc,
  // and Return when the palette is open. Both can coexist because they
  // listen to disjoint key sets.

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

Note: The `isActive` design needs a single owner of arrow keys when palette is visible. For Phase 1 simplicity, InputRow always owns text input and mirrors the buffer to `SLASH_QUERY`; arrow keys for the palette are handled inside `SlashPalette` via its own `useInput({ isActive: paletteVisible })` (added in Task 10). Backspace and typing in InputRow continue to update the buffer regardless.

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test src/rtui/screens/InputRow.test.tsx`
Expected: PASS — slash opens palette, backspace past `/` closes it.

- [ ] **Step 5: Commit**

```bash
git add src/rtui/screens/InputRow.tsx src/rtui/screens/InputRow.test.tsx
git commit -m "RTUI Phase 1: InputRow slash detection mirrors palette query"
```

---

### Task 10: Palette arrow-key handling and selection

**Files:**
- Modify: `src/rtui/screens/SlashPalette.tsx`, `src/rtui/screens/SlashPalette.test.tsx`

- [ ] **Step 1: Write failing test for keyboard handling**

Append to `src/rtui/screens/SlashPalette.test.tsx`:

```tsx
import { runCliCommand } from "../commands/runner.js";
// ... existing imports

test("Down arrow advances selectedIndex; Up arrow retreats", async () => {
  const { stdin, lastFrame } = render(
    <RTUIProvider runtime={runtime}>
      <Seed query="/" sel={0} />
      <SlashPalette />
    </RTUIProvider>,
  );
  await new Promise((r) => setTimeout(r, 5));
  stdin.write("[B"); // Down
  await new Promise((r) => setTimeout(r, 5));
  const frame = lastFrame() ?? "";
  // Second item should have the highlight prefix
  const lines = frame.split("\n");
  const highlightedLine = lines.find((l) => l.includes("❯ /status"));
  expect(highlightedLine).toBeDefined();
});

test("Escape closes the palette", async () => {
  const { stdin, lastFrame } = render(
    <RTUIProvider runtime={runtime}>
      <Seed query="/" sel={0} />
      <SlashPalette />
    </RTUIProvider>,
  );
  await new Promise((r) => setTimeout(r, 5));
  stdin.write(""); // Esc
  await new Promise((r) => setTimeout(r, 5));
  expect(lastFrame() ?? "").not.toContain("/help");
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `bun test src/rtui/screens/SlashPalette.test.tsx`
Expected: FAIL — palette has no input handler yet.

- [ ] **Step 3: Add `useInput` to `SlashPalette`**

Replace `src/rtui/screens/SlashPalette.tsx` with:

```tsx
import { Box, Text, useApp, useInput } from "ink";
import { useSlashOverlay } from "../hooks/useSlashOverlay.js";
import { isSelectable } from "../commands/registry.js";
import { useRTUI } from "../state/context.js";
import { runCliCommand } from "../commands/runner.js";

export function SlashPalette() {
  const { visible, filtered, selectedIndex, move, close, select } = useSlashOverlay();
  const { dispatch } = useRTUI();
  const { exit } = useApp();

  useInput(
    (_char, key) => {
      if (!visible) return;
      if (key.escape) {
        close();
        dispatch({ type: "INPUT_CHANGED", value: "", cursor: 0 });
        return;
      }
      if (key.downArrow) { moveToNextSelectable(filtered, selectedIndex, +1, move); return; }
      if (key.upArrow)   { moveToNextSelectable(filtered, selectedIndex, -1, move); return; }
      if (key.return) {
        const cmd = select();
        if (!cmd) return;
        close();
        dispatch({ type: "INPUT_CHANGED", value: "", cursor: 0 });
        if (cmd.kind === "local") {
          if (cmd.localHandler === "exit") exit();
          // /help: dispatch a system note describing commands
          if (cmd.localHandler === "help") {
            dispatch({
              type: "SCROLLBACK_APPEND",
              item: {
                id: `help-${Date.now().toString(36)}`,
                type: "system_note",
                text: filtered.map((c) => `  ${c.name.padEnd(10)} ${c.description}`).join("\n"),
              },
            });
          }
        } else if (cmd.kind === "cli" && cmd.argv) {
          void runCliCommand({ commandName: cmd.name, argv: cmd.argv, dispatch });
        }
      }
    },
    { isActive: visible },
  );

  if (!visible) return null;
  if (filtered.length === 0) {
    return (
      <Box borderStyle="round" paddingX={1}>
        <Text dimColor>no matching commands</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      {filtered.map((cmd, idx) => {
        const isSel = idx === selectedIndex;
        const disabled = !isSelectable(cmd);
        const prefix = isSel ? "❯ " : "  ";
        return (
          <Box key={cmd.name}>
            <Text color={isSel && !disabled ? "cyan" : undefined} dimColor={disabled}>
              {prefix}{cmd.name.padEnd(10)}  {cmd.description}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

function moveToNextSelectable(
  items: ReturnType<typeof useSlashOverlay>["filtered"],
  current: number,
  delta: number,
  move: (delta: number) => void,
) {
  if (items.length === 0) return;
  let probe = current + delta;
  while (probe >= 0 && probe < items.length && !isSelectable(items[probe]!)) probe += delta;
  if (probe < 0 || probe >= items.length) return;   // no selectable in direction
  move(probe - current);
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test src/rtui/screens/SlashPalette.test.tsx`
Expected: PASS — all SlashPalette tests green.

- [ ] **Step 5: Commit**

```bash
git add src/rtui/screens/SlashPalette.tsx src/rtui/screens/SlashPalette.test.tsx
git commit -m "RTUI Phase 1: SlashPalette keyboard nav + select wiring"
```

---

### Task 11: Mount WelcomeBanner + SlashPalette in Shell; manual smoke

**Files:**
- Modify: `src/rtui/Shell.tsx`

- [ ] **Step 1: Modify `Shell.tsx` to mount the banner + palette + render streaming cli output**

Replace the JSX of `Shell` in `src/rtui/Shell.tsx`:

```tsx
import { Box, Static, Text } from "ink";
import { useEffect, useRef, useState } from "react";
import { useRTUI } from "./state/context.js";
import { ScrollbackArea } from "./screens/ScrollbackArea.js";
import { LiveRegion } from "./screens/LiveRegion.js";
import { InputRow } from "./screens/InputRow.js";
import { StatusLine } from "./screens/StatusLine.js";
import { SlashPalette } from "./screens/SlashPalette.js";
import { WelcomeBanner } from "./screens/WelcomeBanner.js";
import { runCliCommand } from "./commands/runner.js";
import { buildEchoReply } from "./runtime/echo.js";
import type { ScrollbackItem } from "./state/types.js";

function genId(): string {
  return `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function Shell() {
  const { state, dispatch } = useRTUI();
  const lastSubmittedCount = useRef(state.session.messageCount);
  const [recent, setRecent] = useState<string[]>([]);

  // Echo flow (Phase 0)
  useEffect(() => {
    if (state.session.messageCount === lastSubmittedCount.current) return;
    lastSubmittedCount.current = state.session.messageCount;
    const submitted = state.input.history[0];
    if (submitted === undefined) return;
    const userItem: ScrollbackItem = { id: genId(), type: "user_input", text: submitted };
    dispatch({ type: "SCROLLBACK_APPEND", item: userItem });
    const reply = buildEchoReply(submitted);
    const replyItem: ScrollbackItem = { id: genId(), type: "assistant_text", text: reply };
    dispatch({ type: "SCROLLBACK_APPEND", item: replyItem });
  }, [state.session.messageCount, state.input.history, dispatch]);

  // Welcome banner: fetch recent activity once at mount, swallow any failure.
  useEffect(() => {
    const collected: string[] = [];
    void runCliCommand({
      commandName: "/recent (welcome)",
      argv: ["overseer", "recent"],
      dispatch: (action) => {
        if (action.type === "CLI_OUTPUT_LINE") collected.push(action.line);
        if (action.type === "CLI_COMMAND_COMPLETE") {
          setRecent(collected.filter((l) => l.trim().length > 0).slice(0, 3));
        }
      },
    });
  }, []);

  return (
    <Box flexDirection="column">
      <Static items={[{ id: "banner" }]}>
        {() => <WelcomeBanner key="banner" recent={recent} />}
      </Static>
      <ScrollbackArea items={state.scrollback} />
      {state.cli.running ? (
        <Box flexDirection="column">
          <Text dimColor>{`▸ relayos ${state.cli.running.argv.join(" ")}`}</Text>
          {state.cli.streamingLines.map((line, i) => (
            <Text key={i}>{line}</Text>
          ))}
        </Box>
      ) : null}
      <LiveRegion
        spinner={state.live.spinner}
        streaming={state.live.streaming}
        progress={state.live.progress}
      />
      <Box marginTop={1} flexDirection="column">
        <InputRow />
        <StatusLine />
      </Box>
      <SlashPalette />
    </Box>
  );
}
```

- [ ] **Step 2: Run full test suite + typecheck**

Run: `bun test src/rtui/`
Run: `bun x tsc --noEmit`
Expected: Both PASS.

- [ ] **Step 3: Build the RTUI bundle**

Run: `bun run build:rtui`
Expected: `dist/rtui.js` is regenerated, no errors.

- [ ] **Step 4: Manual smoke test (real CLI bridge)**

Run, from an interactive TTY (not piped):

```bash
PATH="$HOME/.bun/bin:$PATH" ./bin/relays
```

Verify each:
1. Welcome banner shows banner art, "Recent activity" with up to 3 entries (or "(none)"), and the three tips.
2. Typing `/` opens the palette listing all commands; disabled ones (`/approve`, `/run`) appear dimmed with "(coming soon)".
3. Typing `/r` filters to `/recent /results /run`.
4. Down arrow moves the highlight; disabled commands are skipped.
5. Selecting `/status` streams the real `overseer status` output into scrollback.
6. Selecting `/exit` quits.
7. Esc closes the palette and clears the input buffer.

- [ ] **Step 5: Commit**

```bash
git add src/rtui/Shell.tsx
git commit -m "RTUI Phase 1: mount WelcomeBanner + SlashPalette in Shell"
```

---

## End-of-Phase Checklist

- [ ] All 11 tasks committed
- [ ] `bun test` → all green (Phase 0 + Phase 1 suites)
- [ ] `bun x tsc --noEmit` → clean
- [ ] `bun run build:rtui` → `dist/rtui.js` rebuilt
- [ ] Manual smoke test (Task 11 Step 4) passes
- [ ] No push — work stays local on `production` per user instruction
