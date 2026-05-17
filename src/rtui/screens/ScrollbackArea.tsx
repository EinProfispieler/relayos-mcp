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
