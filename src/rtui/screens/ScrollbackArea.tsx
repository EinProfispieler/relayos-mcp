import { Box, Static, Text } from "ink";
import type { ScrollbackItem } from "../state/types.js";
import { colors } from "../theme/colors.js";
import { PlanSummary } from "./PlanSummary.js";
import { PlanReport } from "./PlanReport.js";

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
    case "timing_note": {
      const ms = item.ms;
      const label = ms < 2000 ? `${ms}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`;
      const color = ms < 2000 ? colors.ready : ms < 5000 ? colors.thinking : colors.error;
      return (
        <Box>
          <Text color={color}>⏱ </Text>
          <Text color={color}>{label}</Text>
        </Box>
      );
    }
    case "plan_summary":
      return <PlanSummary plan={item.plan} />;
    case "plan_report":
      return <PlanReport data={item.data} />;
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
