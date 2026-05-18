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

const STATUS_COLOR: Record<string, string> = {
  pending: colors.dim,
  running: "yellow",
  completed: colors.ready,
  failed: "red",
  blocked: "red",
};

export function PlanSummary({ plan }: { plan: ProjectPlanView }) {
  const answeredCount = plan.answers?.length ?? 0;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={colors.accent} paddingX={1}>
      <Text color={colors.accent} bold>
        {`Project plan — ${plan.goal}`}
      </Text>

      <Box flexDirection="column" marginTop={1}>
        <Text color={colors.dim}>{`Todo list (${plan.tasks.length} task${plan.tasks.length !== 1 ? "s" : ""}):`}</Text>
        {plan.tasks.map((t) => {
          const mark = STATUS_MARK[t.status] ?? "○";
          const color = STATUS_COLOR[t.status] ?? colors.dim;
          return (
            <Box key={t.id} flexDirection="row">
              <Text color={color}>{`  ${mark} `}</Text>
              <Text>{`${t.id}  ${t.title}`}</Text>
              <Text color={colors.dim}>{`   [${t.target}/${t.model}/${t.effort}/${t.mode}]`}</Text>
              {t.handoffId ? (
                <Text color={colors.dim}>{`   ${t.handoffId.slice(0, 14)}…`}</Text>
              ) : null}
            </Box>
          );
        })}
      </Box>

      {plan.questions.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={colors.thinking}>
            {`Questions (${answeredCount}/${plan.questions.length} answered):`}
          </Text>
          {plan.questions.map((q, i) => {
            const answered = i < answeredCount;
            const answer = plan.answers?.[i];
            return (
              <Box key={i} flexDirection="column">
                <Text color={answered ? colors.dim : undefined}>
                  {`  ${answered ? "✓" : `${i + 1}.`} ${q}`}
                </Text>
                {answered && answer ? (
                  <Text color={colors.dim}>{`      → ${answer}`}</Text>
                ) : null}
              </Box>
            );
          })}
          {answeredCount < plan.questions.length ? (
            <Text color={colors.dim} dimColor>
              {"  Answer in chat, then type /proceed to execute"}
            </Text>
          ) : (
            <Text color={colors.ready}>{"  All answered — type /proceed to execute"}</Text>
          )}
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text color={colors.ready}>{"Type /proceed to execute all tasks"}</Text>
        </Box>
      )}
    </Box>
  );
}
