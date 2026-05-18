import { Box, Text } from "ink";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { useEffect, useRef, useState } from "react";
import { useRTUI } from "./state/context.js";
import { ScrollbackArea } from "./screens/ScrollbackArea.js";
import { LiveRegion } from "./screens/LiveRegion.js";
import { InputRow } from "./screens/InputRow.js";
import { StatusLine } from "./screens/StatusLine.js";
import { SlashPalette } from "./screens/SlashPalette.js";
import { WelcomeBanner } from "./screens/WelcomeBanner.js";
import { SettingsPanel } from "./screens/SettingsPanel.js";
import { SetupWizard } from "./screens/SetupWizard.js";
import { runCliCommand } from "./commands/runner.js";
import type { PendingHandoff, ProjectPlanView, ScrollbackItem } from "./state/types.js";
import { runChatTurn, type ChatTurnResult, type ChatTurnIO } from "../chat.js";
import { loadProjectConfig } from "../config.js";

function genId(): string {
  return `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function appendNote(dispatch: ReturnType<typeof useRTUI>["dispatch"], text: string) {
  dispatch({
    type: "SCROLLBACK_APPEND",
    item: { id: genId(), type: "system_note", text },
  });
}

function appendError(dispatch: ReturnType<typeof useRTUI>["dispatch"], text: string) {
  dispatch({
    type: "SCROLLBACK_APPEND",
    item: { id: genId(), type: "error", text },
  });
}

function formatProposalNote(result: ChatTurnResult): string {
  const ap = result.action_proposal;
  if (!ap) return "";
  const lines: string[] = [];
  if (result.handoff_id) {
    lines.push(`Handoff recorded: ${result.handoff_id}`);
    if (result.handoff_title) lines.push(`  title: ${result.handoff_title}`);
  }
  lines.push(`  action: ${ap.action}${ap.target ? ` → ${ap.target}` : ""}`);
  if (ap.model) lines.push(`  model: ${ap.model}`);
  if (ap.effort) lines.push(`  effort: ${ap.effort}`);
  if (ap.mode) lines.push(`  mode: ${ap.mode}`);
  if (result.needs_approval) {
    lines.push("  ⚠ approval required — type /approve to launch");
  } else if (result.handoff_id) {
    lines.push("  type /approve to launch, or /build to auto-run");
  }
  return lines.join("\n");
}

export function Shell() {
  const { state, dispatch } = useRTUI();
  const lastSubmittedCount = useRef(state.session.messageCount);
  const turnStartTime = useRef<number>(0);
  const [recent, setRecent] = useState<string[]>([]);

  // ── first-run wizard check ────────────────────────────────────────────
  useEffect(() => {
    const configPath = join(process.cwd(), ".relayos", "config.json");
    if (!existsSync(configPath)) {
      dispatch({ type: "WIZARD_OPEN" });
      return;
    }
    // Config exists — check if it has providers configured
    try {
      const { config } = loadProjectConfig({ cwd: process.cwd() });
      const providers = config.overseer?.providers;
      if (!Array.isArray(providers) || providers.length === 0) {
        dispatch({ type: "WIZARD_OPEN" });
      }
    } catch {
      dispatch({ type: "WIZARD_OPEN" });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── welcome "recent" side-load ─────────────────────────────────────────
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

  // ── execute pending handoff helper ────────────────────────────────────
  const executeHandoff = (handoffId: string) => {
    dispatch({ type: "PENDING_HANDOFF_CLEAR" });
    dispatch({ type: "STATUS_SET", status: "executing" });
    void runCliCommand({
      commandName: "execute-handoff",
      argv: ["overseer", "execute-handoff", handoffId],
      dispatch,
    }).then(() => {
      dispatch({ type: "STATUS_SET", status: "idle" });
    });
  };

  // ── plan flow: execute the plan handoff, then extract the PROJECT_PLAN ──
  const runPlanFlow = (handoffId: string) => {
    dispatch({ type: "STATUS_SET", status: "executing" });
    appendNote(dispatch, `Planning the project… (handoff ${handoffId})`);
    void runCliCommand({
      commandName: "execute-handoff",
      argv: ["overseer", "execute-handoff", handoffId],
      dispatch,
    })
      .then(async () => {
        const planLines: string[] = [];
        await runCliCommand({
          commandName: "plan-extract",
          argv: ["overseer", "plan-extract", handoffId],
          dispatch: (action) => {
            if (action.type === "CLI_OUTPUT_LINE") planLines.push(action.line);
          },
        });
        const planLine = planLines.find((l) => l.startsWith("@@RELAYOS_PLAN@@ "));
        if (!planLine) {
          appendError(dispatch, "Could not extract a project plan from the planning output.");
          dispatch({ type: "STATUS_SET", status: "idle" });
          return;
        }
        try {
          const raw = JSON.parse(planLine.slice("@@RELAYOS_PLAN@@ ".length)) as {
            plan_id: string;
            goal: string;
            questions?: string[];
            tasks?: Array<Record<string, string>>;
          };
          const view: ProjectPlanView = {
            planId: raw.plan_id,
            goal: raw.goal,
            questions: raw.questions ?? [],
            tasks: (raw.tasks ?? []).map((t) => ({
              id: t.id ?? "",
              title: t.title ?? "",
              target: t.target ?? "",
              model: t.model ?? "",
              effort: t.effort ?? "",
              mode: t.mode ?? "",
              status: t.status ?? "pending",
            })),
          };
          dispatch({ type: "PROJECT_PLAN_SET", plan: view });
          dispatch({
            type: "SCROLLBACK_APPEND",
            item: { id: genId(), type: "plan_summary", plan: view },
          });
          dispatch({ type: "STATUS_SET", status: "awaiting_answers" });
        } catch {
          appendError(dispatch, "Planning output was malformed.");
          dispatch({ type: "STATUS_SET", status: "idle" });
        }
      });
  };

  // ── slash command handler (direct-typed) ──────────────────────────────
  const handleLocalSlash = (cmd: string): boolean => {
    const lower = cmd.trim().toLowerCase();

    if (lower === "/build") {
      const next = state.mode === "step" ? "build" : "step";
      dispatch({ type: "MODE_SET", mode: next });
      appendNote(dispatch, `Mode switched to ${next.toUpperCase()} — ${
        next === "build"
          ? "non-gated handoffs will auto-execute"
          : "type /approve to launch handoffs"
      }`);
      return true;
    }

    if (lower === "/approve" || lower === "/run") {
      if (!state.pendingHandoff) {
        appendError(dispatch, "No pending handoff. Submit a coding request first.");
      } else {
        appendNote(dispatch, `Launching handoff ${state.pendingHandoff.handoffId}…`);
        executeHandoff(state.pendingHandoff.handoffId);
      }
      return true;
    }

    // Not a locally-handled slash command
    return false;
  };

  // ── main pipeline effect ───────────────────────────────────────────────
  useEffect(() => {
    if (state.session.messageCount === lastSubmittedCount.current) return;
    lastSubmittedCount.current = state.session.messageCount;

    const submitted = state.input.history[0];
    if (submitted === undefined) return;

    const trimmed = submitted.trim();

    // Append user input to scrollback
    const userItem: ScrollbackItem = { id: genId(), type: "user_input", text: submitted };
    dispatch({ type: "SCROLLBACK_APPEND", item: userItem });

    // Handle slash commands typed directly (not via palette)
    if (trimmed.startsWith("/")) {
      handleLocalSlash(trimmed);
      return;
    }

    // ── real AI pipeline — called directly in-process (no subprocess) ───
    turnStartTime.current = Date.now();
    dispatch({ type: "STATUS_SET", status: "thinking" });

    void (async () => {
      const lines: string[] = [];
      const io: ChatTurnIO = {
        stdout: { write: (s: string) => { lines.push(s); } },
        stderr: { write: (s: string) => { process.stderr.write(s); } },
      };

      try {
        await runChatTurn(trimmed, io);
      } catch (err) {
        appendError(dispatch, `chat-turn: unexpected error: ${String(err)}`);
        dispatch({ type: "STATUS_SET", status: "idle" });
        return;
      }

      const sentinel = lines.find((l) => l.startsWith("@@RELAYOS_TURN@@ "));
      if (!sentinel) {
        appendError(dispatch, `chat-turn: no structured response.\n${lines.slice(0, 3).join("\n")}`);
        dispatch({ type: "STATUS_SET", status: "idle" });
        return;
      }

      let result: ChatTurnResult;
      try {
        result = JSON.parse(sentinel.slice("@@RELAYOS_TURN@@ ".length)) as ChatTurnResult;
      } catch {
        appendError(dispatch, `chat-turn: malformed JSON in response.`);
        dispatch({ type: "STATUS_SET", status: "idle" });
        return;
      }

      // Show assistant reply + timing
      const elapsed = result.provider_latency_ms ?? (Date.now() - turnStartTime.current);
      if (result.reply && result.reply.trim().length > 0) {
        dispatch({
          type: "SCROLLBACK_APPEND",
          item: { id: genId(), type: "assistant_text", text: result.reply },
        });
      }
      dispatch({
        type: "SCROLLBACK_APPEND",
        item: { id: genId(), type: "timing_note", ms: elapsed },
      });

      // project_plan turn → run the plan flow (execute + extract), then stop.
      if (result.handoff_kind === "plan") {
        if (result.handoff_id) {
          runPlanFlow(result.handoff_id);
        } else {
          appendError(dispatch, "Plan handoff could not be created.");
          dispatch({ type: "STATUS_SET", status: "idle" });
        }
        return;
      }

      // Show proposal note
      if (result.action_proposal) {
        const note = formatProposalNote(result);
        if (note) appendNote(dispatch, note);
      }

      // Set pending handoff state
      if (result.handoff_id) {
        const ph: PendingHandoff = {
          handoffId: result.handoff_id,
          title: result.handoff_title ?? result.handoff_id,
          needsApproval: result.needs_approval,
        };
        dispatch({ type: "PENDING_HANDOFF_SET", handoff: ph });

        // Build mode: auto-execute non-gated handoffs
        if (state.mode === "build" && !result.needs_approval) {
          appendNote(dispatch, `Build mode: auto-launching ${result.handoff_id}…`);
          executeHandoff(result.handoff_id);
          return; // executeHandoff sets status
        }
      }

      // Set final status
      if (result.needs_approval || (result.handoff_id && state.mode !== "build")) {
        dispatch({ type: "STATUS_SET", status: "awaiting_approval" });
      } else {
        dispatch({ type: "STATUS_SET", status: "idle" });
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.session.messageCount]);

  const showBanner = state.session.messageCount === 0 && state.scrollback.length === 0;

  return (
    <Box flexDirection="column">
      {state.wizardOpen ? (
        <SetupWizard
          cwd={process.cwd()}
          onClose={() => dispatch({ type: "WIZARD_CLOSE" })}
          onOpenSettings={() => dispatch({ type: "SETTINGS_OPEN" })}
        />
      ) : null}
      {state.settingsOpen ? (
        <SettingsPanel onClose={() => dispatch({ type: "SETTINGS_CLOSE" })} />
      ) : null}
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
