# RTUI Phase 1: Slash Palette + Welcome Banner

**Date:** 2026-05-17
**Status:** Approved for planning
**Depends on:** Phase 0 foundation (`docs/superpowers/plans/2026-05-17-rtui-phase0-foundation.md`)

## Goal

Add a Codex-style welcome screen on RTUI launch, and a slash-command palette overlay that lets the user type `/` to pop down a menu, filter commands, and select one. Selected commands either run inside the RTUI (local) or shell out to the existing `dist/cli.js` Node CLI in read-only mode and stream output into scrollback.

Phase 1 is the first user-facing feature on top of the Phase 0 foundation. It does not introduce write actions or persistent state — those are deferred to later phases.

## Architecture

```
App
├── <Static>                             (immutable scrollback)
│   ├── WelcomeBanner                    (rendered once at session start)
│   └── completed messages / CLI output
├── LiveRegion                           (mutable: streaming CLI output)
├── InputRow                             (text entry; useInput gated by palette.visible)
└── SlashPalette                         (absolute popdown; mounted when palette.visible)
```

All slash-palette and CLI-runner state lives in the existing `useReducer` store (`src/rtui/state/`). The store gains a `palette` slice and a `cli` slice. No new context providers.

Keyboard routing: `useInput(handler, { isActive })` toggles between InputRow and SlashPalette based on `state.palette.visible`. Only one handler is active at a time, which Ink supports natively.

CLI execution: `child_process.spawn(process.execPath, [pathToCliJs, ...argv], { stdio: ["ignore", "pipe", "pipe"] })`. Read-only — stdin is closed, no shell, no environment changes. Stdout lines stream into the LiveRegion via dispatch; on exit they're flushed into the `<Static>` scrollback.

## Tech Stack

- React 19.2.6 + Ink 7.0.3 (already in `package.json`)
- `child_process.spawn` for CLI bridge (Node stdlib)
- `bun:test` + `ink-testing-library` (already in use for Phase 0)
- TypeScript with `moduleResolution: "bundler"` — all relative imports use `.js` extension

## Slash Command Registry

Single source of truth at `src/rtui/commands/registry.ts`. Each entry:

```ts
type CommandKind = "local" | "cli" | "disabled";

interface SlashCommand {
  name: string;            // e.g. "/status"
  description: string;     // one-line palette description
  kind: CommandKind;
  // For kind === "cli": argv passed to dist/cli.js
  argv?: readonly string[];
  // For kind === "local": handler invoked with the RTUI store
  handler?: (store: { dispatch: Dispatch; getState: () => RTUIState }) => void | Promise<void>;
}
```

Phase 1 ships exactly these commands, in this order:

| Name        | Kind     | argv / handler                     | Description (palette text)           |
|-------------|----------|-------------------------------------|--------------------------------------|
| `/help`     | local    | `showHelp()`                        | Show available commands              |
| `/status`   | cli      | `["overseer", "status"]`            | Overseer runtime status              |
| `/recent`   | cli      | `["overseer", "recent"]`            | Recent activity                      |
| `/next`     | cli      | `["overseer", "next"]`              | Next recommended action              |
| `/results`  | cli      | `["overseer", "handoff-results"]`   | Completed handoff results            |
| `/settings` | cli      | `["settings"]`                      | Open provider/settings wizard        |
| `/exit`     | local    | `exitApp()`                         | Quit RTUI                            |
| `/approve`  | disabled | —                                   | Approve handoff (coming soon)        |
| `/run`      | disabled | —                                   | Execute handoff (coming soon)        |

Disabled commands appear in the palette in a dimmed color with a `(coming soon)` suffix and are not selectable (Return is a no-op when the highlighted item is disabled — selection skips them as arrow keys move).

## Welcome Banner

Rendered exactly once at session start, as the first child inside `<Static>`. Three sections, stacked vertically with a single blank line between them:

1. **Banner art** — Reuse `printBanner` text from the existing `dist/cli.js banner` output. To avoid coupling to the CLI for cosmetic content, copy the banner string into a constant `WELCOME_BANNER_ART` in `src/rtui/components/WelcomeBanner.tsx`.
2. **Recent activity** — Call `overseer recent` once at mount via the same `runCliCommand` runner. Take the first 3 non-empty lines and render under a "Recent activity:" heading. If the call fails or returns nothing, render "Recent activity: (none)".
3. **Tips** — Three hard-coded hints:
   - `Type / to open the command palette`
   - `Use ↑/↓ to navigate, Return to select, Esc to dismiss`
   - `Type /help for the full command list`

The banner does not re-render on subsequent state changes. It is part of the immutable `<Static>` stream.

## Slash Palette Behavior

**Opening**: When InputRow's value is exactly `/` at column 0, dispatch `SLASH_OPEN`. The character `/` remains in the input buffer (visible) and the palette appears above it.

**Filtering**: As the user types additional characters, the InputRow buffer (e.g. `/sta`) is mirrored to `state.palette.query`. The palette filters commands whose name starts with the query (case-insensitive prefix match on the substring after the leading `/`). No fuzzy matching in Phase 1.

**Navigation**: While palette is visible, the palette's `useInput` is active and InputRow's is not. Up/Down arrows move `selectedIndex` (skipping disabled items). Return invokes the selected command. Esc dispatches `SLASH_CLOSE` and clears the input buffer.

**Closing**: Selecting a command, pressing Esc, or backspacing past the leading `/` all close the palette. On close, focus returns to InputRow.

**Empty filter**: If the query matches nothing, palette shows "(no matching commands)" and Return is a no-op.

## CLI Bridge

`src/rtui/commands/runner.ts` exports `runCliCommand(argv: readonly string[], store)`. Behavior:

1. Dispatch `CLI_COMMAND_START` with `{ commandName, argv }`. LiveRegion shows `> relayos <argv joined>` followed by a streaming output area.
2. Spawn `process.execPath` with `[absolutePathToCliJs, ...argv]`. `cwd` is `process.cwd()`. `stdio: ["ignore", "pipe", "pipe"]`. No shell.
3. Pipe stdout through a line splitter. For each line dispatch `CLI_OUTPUT_LINE { line }`. Stderr lines get the same treatment but prefixed with `[stderr] `.
4. On exit, dispatch `CLI_COMMAND_COMPLETE { exitCode }`. The runner appends `(exit N)` if non-zero. The reducer moves the streaming buffer into `<Static>` scrollback.

The absolute path to `cli.js` is resolved at module load via `new URL("../../../dist/cli.js", import.meta.url)` and converted with `fileURLToPath`. This works for both `bun run` and `bun build` outputs.

Only one CLI command runs at a time. If the user opens the palette and selects a second command while one is running, the second is queued (dispatch `CLI_COMMAND_QUEUE`) and starts when the current one completes. The palette stays usable during execution.

## State Changes

New slices on `RTUIState`:

```ts
interface PaletteState {
  visible: boolean;
  query: string;              // includes leading "/"
  selectedIndex: number;
}

interface CliState {
  running: { commandName: string; argv: readonly string[] } | null;
  queue: ReadonlyArray<{ commandName: string; argv: readonly string[] }>;
  streamingLines: readonly string[];  // current command's live output
}
```

New actions:

- `SLASH_OPEN`
- `SLASH_QUERY { query: string }`
- `SLASH_CLOSE`
- `SLASH_MOVE { delta: number }`
- `SLASH_SELECT`
- `CLI_COMMAND_START { commandName, argv }`
- `CLI_COMMAND_QUEUE { commandName, argv }`
- `CLI_OUTPUT_LINE { line }`
- `CLI_COMMAND_COMPLETE { exitCode }`

Existing scrollback append action is reused when `CLI_COMMAND_COMPLETE` fires.

## File Plan

**Create:**
- `src/rtui/commands/registry.ts`
- `src/rtui/commands/registry.test.ts`
- `src/rtui/commands/runner.ts`
- `src/rtui/commands/runner.test.ts`
- `src/rtui/hooks/useSlashOverlay.ts`
- `src/rtui/hooks/useSlashOverlay.test.tsx`
- `src/rtui/components/SlashPalette.tsx`
- `src/rtui/components/SlashPalette.test.tsx`
- `src/rtui/components/WelcomeBanner.tsx`
- `src/rtui/components/WelcomeBanner.test.tsx`

**Modify:**
- `src/rtui/state/types.ts` — add `PaletteState`, `CliState` slices and new action variants
- `src/rtui/state/reducer.ts` — handle new actions
- `src/rtui/state/reducer.test.ts` — cover new actions
- `src/rtui/components/InputRow.tsx` — detect leading `/`, mirror buffer to palette query, gate `useInput` by palette visibility
- `src/rtui/components/InputRow.test.tsx` — cover slash detection + gating
- `src/rtui/App.tsx` — mount `WelcomeBanner` once and `SlashPalette` when visible

## Testing Strategy

Per-component unit tests with `ink-testing-library` + `bun:test`:

- Registry: command list shape, disabled flag, no duplicate names.
- Runner: spawns Node with correct argv, dispatches START/OUTPUT/COMPLETE in order, queues second command, handles non-zero exit. Mock `child_process.spawn` with a small fake that emits scripted stdout lines.
- `useSlashOverlay`: open/close/query/move/select transitions via reducer.
- SlashPalette: filters by prefix, dims disabled items, skips disabled on arrow, no-op Return on disabled.
- WelcomeBanner: renders three sections; handles empty/failing `overseer recent` gracefully.
- InputRow: typing `/` at column 0 opens palette, mirrors buffer to query, backspace past `/` closes.
- App integration: rendering with mock runtime shows banner; pressing `/` shows palette.

No end-to-end test against the real `dist/cli.js` in this phase — the runner test mocks spawn. A separate manual smoke step in the plan verifies the real CLI bridge.

## Error Handling

- CLI binary missing: runner dispatches `CLI_COMMAND_COMPLETE { exitCode: -1 }` with a single output line `error: dist/cli.js not found at <path>`.
- CLI non-zero exit: output already streamed; the trailing `(exit N)` indicates failure. No popup, no retry.
- Welcome banner CLI failure: render `Recent activity: (unavailable)` and continue. Failure does not block startup.
- Unknown slash command typed and Return pressed with no palette match: no-op, palette stays open.

## Out of Scope (Deferred)

- Write commands (`/approve`, `/run`) — shipped as disabled stubs only.
- Command history persistence across sessions.
- Fuzzy matching beyond simple prefix.
- Resizing the palette to available terminal height.
- Mouse interaction.
- Theming / color customization.

## Open Questions

None — design approved by user 2026-05-17.
