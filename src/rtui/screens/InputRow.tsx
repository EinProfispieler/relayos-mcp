import { Box, Text, useInput } from "ink";
import { useRTUI } from "../state/context.js";
import { colors } from "../theme/colors.js";

export function InputRow() {
  const { state, dispatch } = useRTUI();
  const { value, cursor } = state.input;
  const paletteVisible = state.palette.visible;

  useInput((char, key) => {
    // When the palette is visible, it owns Return / arrows / Esc.
    // InputRow only handles character typing and backspace so the
    // buffer (and thus the palette query) stays in sync.
    if (
      paletteVisible &&
      (key.return || key.upArrow || key.downArrow || key.escape || key.leftArrow || key.rightArrow)
    ) {
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
