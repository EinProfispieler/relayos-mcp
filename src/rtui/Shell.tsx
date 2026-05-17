import { Box, Static, Text } from "ink";
import { useEffect, useRef, useState } from "react";
import { useRTUI } from "./state/context.js";
import { ScrollbackArea } from "./screens/ScrollbackArea.js";
import { LiveRegion } from "./screens/LiveRegion.js";
import { InputRow } from "./screens/InputRow.js";
import { StatusLine } from "./screens/StatusLine.js";
import { SlashPalette } from "./screens/SlashPalette.js";
import { WelcomeBanner } from "./screens/WelcomeBanner.js";
import { runCliCommand } from "./commands/runner.js";
import { buildEchoReply } from "./runtime/echo.js";
import type { ScrollbackItem } from "./state/types.js";

function genId(): string {
  return `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function Shell() {
  const { state, dispatch } = useRTUI();
  const lastSubmittedCount = useRef(state.session.messageCount);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    if (state.session.messageCount === lastSubmittedCount.current) return;
    lastSubmittedCount.current = state.session.messageCount;

    const submitted = state.input.history[0];
    if (submitted === undefined) return;

    const userItem: ScrollbackItem = { id: genId(), type: "user_input", text: submitted };
    dispatch({ type: "SCROLLBACK_APPEND", item: userItem });

    const reply = buildEchoReply(submitted);
    const replyItem: ScrollbackItem = { id: genId(), type: "assistant_text", text: reply };
    dispatch({ type: "SCROLLBACK_APPEND", item: replyItem });
  }, [state.session.messageCount, state.input.history, dispatch]);

  useEffect(() => {
    const collected: string[] = [];
    void runCliCommand({
      commandName: "/recent (welcome)",
      argv: ["overseer", "recent"],
      dispatch: (action) => {
        if (action.type === "CLI_OUTPUT_LINE") collected.push(action.line);
        if (action.type === "CLI_COMMAND_COMPLETE") {
          setRecent(collected.filter((l) => l.trim().length > 0).slice(0, 3));
        }
      },
    });
  }, []);

  return (
    <Box flexDirection="column">
      <Static items={[{ id: "banner" }]}>
        {() => <WelcomeBanner key="banner" recent={recent} />}
      </Static>
      <ScrollbackArea items={state.scrollback} />
      {state.cli.running ? (
        <Box flexDirection="column">
          <Text dimColor>{`▸ relayos ${state.cli.running.argv.join(" ")}`}</Text>
          {state.cli.streamingLines.map((line, i) => (
            <Text key={i}>{line}</Text>
          ))}
        </Box>
      ) : null}
      <LiveRegion
        spinner={state.live.spinner}
        streaming={state.live.streaming}
        progress={state.live.progress}
      />
      <Box marginTop={1} flexDirection="column">
        <InputRow />
        <StatusLine />
      </Box>
      <SlashPalette />
    </Box>
  );
}
