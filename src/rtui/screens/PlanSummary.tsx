import { Box, Text } from "ink";
import type { ProjectPlanView } from "../state/types.js";
import { colors } from "../theme/colors.js";

const STATUS_MARK: Record<string, string> = {
  pending: "○",
  running: "◐",
  completed: "●",
  failed: "✗",
  blocked: "⊘",
};

export function PlanSummary({ plan }: { plan: ProjectPlanView }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={colors.accent} paddingX={1}>
      <Text color={colors.accent} bold>
        {`Project plan — ${plan.goal}`}
      </Text>

      <Box flexDirection="column" marginTop={1}>
        <Text color={colors.dim}>{`Todo list (${plan.tasks.length} tasks):`}</Text>
        {plan.tasks.map((t) => (
          <Box key={t.id} flexDirection="row">
            <Text>{`  ${STATUS_MARK[t.status] ?? "○"} ${t.id}  ${t.title}`}</Text>
            <Text color={colors.dim}>{`   [${t.target}/${t.model}/${t.effort}/${t.mode}]`}</Text>
          </Box>
        ))}
      </Box>

      {plan.questions.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={colors.thinking}>Questions — answer these in chat:</Text>
          {plan.questions.map((q, i) => (
            <Text key={i}>{`  ${i + 1}. ${q}`}</Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
