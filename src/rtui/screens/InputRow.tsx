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
