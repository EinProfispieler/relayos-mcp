import { Box, Text } from "ink";
import { useRTUI } from "../state/context.js";
import { colors } from "../theme/colors.js";

function statusLabel(status: string): string {
  switch (status) {
    case "thinking": return "Thinking";
    case "awaiting_approval": return "Awaiting approval";
    case "executing": return "Executing";
    default: return "Ready";
  }
}

export function StatusLine() {
  const { state } = useRTUI();
  const { runtime, status, mode, pendingHandoff } = state;
  const sep = <Text color={colors.dim}> · </Text>;

  return (
    <Box flexWrap="wrap">
      <Text>{`${runtime.model} ${runtime.effort}`}</Text>
      {sep}
      <Text color={colors.ready}>{`~/${runtime.projectDir}`}</Text>
      {sep}
      <Text color={colors.branch}>{runtime.branch}</Text>
      {sep}
      <Text color={mode === "build" ? "yellow" : colors.dim}>{mode.toUpperCase()}</Text>
      {sep}
      <Text color={status === "idle" ? colors.ready : colors.pending}>{statusLabel(status)}</Text>
      {pendingHandoff ? (
        <>
          {sep}
          <Text color="cyan">{`[${pendingHandoff.needsApproval ? "⚠ " : ""}${pendingHandoff.handoffId.slice(0, 12)}… /approve]`}</Text>
        </>
      ) : null}
    </Box>
  );
}
