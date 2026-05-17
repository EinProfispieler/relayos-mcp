import { Box, Text, useApp, useInput } from "ink";
import { useSlashOverlay } from "../hooks/useSlashOverlay.js";
import { isSelectable, type SlashCommand } from "../commands/registry.js";
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
          if (cmd.localHandler === "help") {
            dispatch({
              type: "SCROLLBACK_APPEND",
              item: {
                id: `help-${Date.now().toString(36)}`,
                type: "system_note",
                text: filtered
                  .map((c) => `  ${c.name.padEnd(10)} ${c.description}`)
                  .join("\n"),
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
