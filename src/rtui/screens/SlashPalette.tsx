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
