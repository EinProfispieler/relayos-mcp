import { Box, Text } from "ink";
import type { PlanReportData } from "../../project_plan.js";
import { colors } from "../theme/colors.js";

const STATUS_COLOR: Record<string, string> = {
  completed: colors.ready,
  failed: "red",
  blocked: "red",
  pending: colors.dim,
  running: "yellow",
};

export function PlanReport({ data }: { data: PlanReportData }) {
  const { summary } = data;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={colors.accent} paddingX={1}>
      <Text color={colors.accent} bold>{`Plan report — ${data.goal}`}</Text>
      <Text color={colors.dim}>{`Generated: ${data.generated_at}`}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>{`${summary.total} tasks: `}
          <Text color={colors.ready}>{`${summary.completed} completed`}</Text>
          {summary.failed > 0 ? <Text color="red">{`  ${summary.failed} failed`}</Text> : null}
          {summary.blocked > 0 ? <Text color="red">{`  ${summary.blocked} blocked`}</Text> : null}
          {summary.pending > 0 ? <Text color={colors.dim}>{`  ${summary.pending} pending`}</Text> : null}
        </Text>
      </Box>
      {data.tasks.map((t) => (
        <Box key={t.id} flexDirection="column" marginTop={1}>
          <Box>
            <Text color={STATUS_COLOR[t.status] ?? colors.dim}>{`  ${t.id}  `}</Text>
            <Text>{t.title}</Text>
            <Text color={colors.dim}>{`  [${t.status}]`}</Text>
            {t.needs_review ? <Text color="yellow">{`  ⚑ needs review`}</Text> : null}
          </Box>
          {t.result_summary ? (
            <Text color={colors.dim}>{`      ${t.result_summary}`}</Text>
          ) : null}
          {t.blockers && t.blockers.length > 0 ? (
            t.blockers.map((b, i) => <Text key={i} color="red">{`      ⚠ ${b}`}</Text>)
          ) : null}
        </Box>
      ))}
    </Box>
  );
}
