import { Box, Text, useApp, useInput } from "ink";
import { useSlashOverlay } from "../hooks/useSlashOverlay.js";
import { SLASH_COMMANDS, isSelectable, type SlashCommand } from "../commands/registry.js";
import { useRTUI } from "../state/context.js";
import { runCliCommand } from "../commands/runner.js";

function genId(): string {
  return `pal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function SlashPalette() {
  const { visible, filtered, selectedIndex, move, close, select } = useSlashOverlay();
  const { state, dispatch } = useRTUI();
  const { exit } = useApp();

  useInput(
    (_char, key) => {
      if (!visible) return;
      if (key.escape) {
        close();
        dispatch({ type: "INPUT_CHANGED", value: "", cursor: 0 });
        return;
      }
      if (key.downArrow) {
        moveToNextSelectable(filtered, selectedIndex, +1, move);
        return;
      }
      if (key.upArrow) {
        moveToNextSelectable(filtered, selectedIndex, -1, move);
        return;
      }
      if (key.return) {
        const cmd = select();
        if (!cmd) return;
        close();
        dispatch({ type: "INPUT_CHANGED", value: "", cursor: 0 });
        if (cmd.kind === "local") {
          if (cmd.localHandler === "exit") exit();
          if (cmd.localHandler === "settings") dispatch({ type: "SETTINGS_OPEN" });
          if (cmd.localHandler === "setup") dispatch({ type: "WIZARD_OPEN" });
          if (cmd.localHandler === "help") {
            dispatch({
              type: "SCROLLBACK_APPEND",
              item: {
                id: `help-${Date.now().toString(36)}`,
                type: "system_note",
                text: SLASH_COMMANDS
                  .map((c) => `  ${c.name.padEnd(10)} ${c.description}`)
                  .join("\n"),
              },
            });
          }
          if (cmd.localHandler === "build") {
            const next = state.mode === "step" ? "build" : "step";
            dispatch({ type: "MODE_SET", mode: next });
            dispatch({
              type: "SCROLLBACK_APPEND",
              item: {
                id: genId(),
                type: "system_note",
                text: `Mode switched to ${next.toUpperCase()} — ${
                  next === "build"
                    ? "non-gated handoffs will auto-execute"
                    : "type /approve to launch handoffs"
                }`,
              },
            });
          }
          if (cmd.localHandler === "approve" || cmd.localHandler === "run") {
            if (!state.pendingHandoff) {
              dispatch({
                type: "SCROLLBACK_APPEND",
                item: { id: genId(), type: "error", text: "No pending handoff. Submit a coding request first." },
              });
            } else {
              const handoffId = state.pendingHandoff.handoffId;
              dispatch({ type: "PENDING_HANDOFF_CLEAR" });
              dispatch({ type: "STATUS_SET", status: "executing" });
              dispatch({
                type: "SCROLLBACK_APPEND",
                item: { id: genId(), type: "system_note", text: `Launching handoff ${handoffId}…` },
              });
              void runCliCommand({
                commandName: "execute-handoff",
                argv: ["overseer", "execute-handoff", handoffId],
                dispatch,
              }).then(() => {
                dispatch({ type: "STATUS_SET", status: "idle" });
              });
            }
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
  items: readonly SlashCommand[],
  current: number,
  delta: number,
  move: (delta: number) => void,
) {
  if (items.length === 0) return;
  let probe = current + delta;
  while (probe >= 0 && probe < items.length && !isSelectable(items[probe]!)) probe += delta;
  if (probe < 0 || probe >= items.length) return;
  move(probe - current);
}
