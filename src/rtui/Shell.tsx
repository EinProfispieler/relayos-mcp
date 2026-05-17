import { Box } from "ink";
import { useEffect, useRef } from "react";
import { useRTUI } from "./state/context.js";
import { ScrollbackArea } from "./screens/ScrollbackArea.js";
import { LiveRegion } from "./screens/LiveRegion.js";
import { InputRow } from "./screens/InputRow.js";
import { StatusLine } from "./screens/StatusLine.js";
import { buildEchoReply } from "./runtime/echo.js";
import type { ScrollbackItem } from "./state/types.js";

function genId(): string {
  return `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function Shell() {
  const { state, dispatch } = useRTUI();
  const lastSubmittedCount = useRef(state.session.messageCount);

  // Detect a fresh submission by watching messageCount delta.
  useEffect(() => {
    if (state.session.messageCount === lastSubmittedCount.current) return;
    lastSubmittedCount.current = state.session.messageCount;

    // The reducer already cleared input. Reconstruct the submitted text
    // from the freshest history entry.
    const submitted = state.input.history[0];
    if (submitted === undefined) return;

    const userItem: ScrollbackItem = { id: genId(), type: "user_input", text: submitted };
    dispatch({ type: "SCROLLBACK_APPEND", item: userItem });

    const reply = buildEchoReply(submitted);
    const replyItem: ScrollbackItem = { id: genId(), type: "assistant_text", text: reply };
    dispatch({ type: "SCROLLBACK_APPEND", item: replyItem });
  }, [state.session.messageCount, state.input.history, dispatch]);

  return (
    <Box flexDirection="column">
      <ScrollbackArea items={state.scrollback} />
      <LiveRegion
        spinner={state.live.spinner}
        streaming={state.live.streaming}
        progress={state.live.progress}
      />
      <Box marginTop={1} flexDirection="column">
        <InputRow />
        <StatusLine />
      </Box>
    </Box>
  );
}
