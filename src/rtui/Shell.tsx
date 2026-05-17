import { Box, Text, useApp } from "ink";
import { useEffect, useRef, useState } from "react";
import { useRTUI } from "./state/context.js";
import { ScrollbackArea } from "./screens/ScrollbackArea.js";
import { LiveRegion } from "./screens/LiveRegion.js";
import { InputRow } from "./screens/InputRow.js";
import { StatusLine } from "./screens/StatusLine.js";
import { SlashPalette } from "./screens/SlashPalette.js";
import { WelcomeBanner } from "./screens/WelcomeBanner.js";
import { runCliCommand } from "./commands/runner.js";
import { SLASH_COMMANDS } from "./commands/registry.js";
import { buildEchoReply } from "./runtime/echo.js";
import type { ScrollbackItem } from "./state/types.js";

function genId(): string {
  return `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function Shell() {
  const { state, dispatch } = useRTUI();
  const { exit } = useApp();
  const lastSubmittedCount = useRef(state.session.messageCount);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    if (state.session.messageCount === lastSubmittedCount.current) return;
    lastSubmittedCount.current = state.session.messageCount;

    const submitted = state.input.history[0];
    if (submitted === undefined) return;

    const userItem: ScrollbackItem = { id: genId(), type: "user_input", text: submitted };
    dispatch({ type: "SCROLLBACK_APPEND", item: userItem });

    if (submitted.startsWith("/")) {
      const cmd = SLASH_COMMANDS.find((c) => c.name === submitted.trim());
      if (!cmd) {
        dispatch({
          type: "SCROLLBACK_APPEND",
          item: { id: genId(), type: "error", text: `Unknown command: ${submitted}` },
        });
        return;
      }
      if (cmd.kind === "disabled") {
        dispatch({
          type: "SCROLLBACK_APPEND",
          item: { id: genId(), type: "system_note", text: `${cmd.name} is not available yet.` },
        });
        return;
      }
      if (cmd.kind === "local") {
        if (cmd.localHandler === "exit") {
          exit();
          return;
        }
        if (cmd.localHandler === "help") {
          dispatch({
            type: "SCROLLBACK_APPEND",
            item: {
              id: `help-${Date.now().toString(36)}`,
              type: "system_note",
              text: SLASH_COMMANDS
                .map((c) => `  ${c.name.padEnd(10)} ${c.description}`)
                .join("\n"),
            },
          });
        }
        return;
      }
      if (cmd.kind === "cli" && cmd.argv) {
        void runCliCommand({ commandName: cmd.name, argv: cmd.argv, dispatch });
        return;
      }
    }

    const reply = buildEchoReply(submitted);
    const replyItem: ScrollbackItem = { id: genId(), type: "assistant_text", text: reply };
    dispatch({ type: "SCROLLBACK_APPEND", item: replyItem });
  }, [state.session.messageCount, state.input.history, dispatch, exit]);

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

  const showBanner = state.session.messageCount === 0 && state.scrollback.length === 0;

  return (
    <Box flexDirection="column">
      {showBanner ? <WelcomeBanner recent={recent} /> : null}
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
      <SlashPalette />
      <Box marginTop={1} flexDirection="column">
        <InputRow />
        <StatusLine />
      </Box>
    </Box>
  );
}
