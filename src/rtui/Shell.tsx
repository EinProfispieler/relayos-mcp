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
import type { PendingHandoff, PlanReportData, ProjectPlanView, ScrollbackItem } from "./state/types.js";
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
            answers: (Array.isArray((raw as Record<string, unknown>).answers) ? (raw as Record<string, unknown>).answers : []) as string[],
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

  // ── proceed flow: execute plan tasks in sequence ─────────────────────
  const runProceedFlow = (planId: string) => {
    const plan = state.projectPlan;
    if (!plan) return;

    const pendingTasks = plan.tasks.filter((t) => t.status === "pending");
    if (pendingTasks.length === 0) {
      appendNote(dispatch, "All tasks are already dispatched or completed.");
      return;
    }

    dispatch({ type: "STATUS_SET", status: "executing" });
    appendNote(dispatch, `Proceeding with ${pendingTasks.length} task(s)…`);

    // Execute tasks sequentially (each one resolves before the next starts)
    const runNext = async (tasks: typeof pendingTasks): Promise<void> => {
      const task = tasks[0];
      if (!task) {
        dispatch({ type: "STATUS_SET", status: "idle" });
        appendNote(dispatch, "All plan tasks dispatched.");
        // Generate plan report
        const reportLines: string[] = [];
        await runCliCommand({
          commandName: "plan-report",
          argv: ["overseer", "plan-report", planId],
          dispatch: (a) => { if (a.type === "CLI_OUTPUT_LINE") reportLines.push(a.line); },
        });
        const reportSentinel = reportLines.find((l) => l.startsWith("@@RELAYOS_PLAN_REPORT@@ "));
        if (reportSentinel) {
          try {
            const reportData = JSON.parse(reportSentinel.slice("@@RELAYOS_PLAN_REPORT@@ ".length)) as PlanReportData;
            dispatch({ type: "SCROLLBACK_APPEND", item: { id: genId(), type: "plan_report", data: reportData } });
          } catch {
            // silently skip bad report data
          }
        }
        return;
      }

      appendNote(dispatch, `Creating handoff for task [${task.id}]: ${task.title}…`);
      const taskLines: string[] = [];
      await runCliCommand({
        commandName: `plan-task-handoff`,
        argv: ["overseer", "plan-task-handoff", planId, task.id],
        dispatch: (action) => {
          if (action.type === "CLI_OUTPUT_LINE") taskLines.push(action.line);
        },
      });

      const sentinel = taskLines.find((l) => l.startsWith("@@RELAYOS_TASK_HANDOFF@@ "));
      if (!sentinel) {
        appendError(dispatch, `Failed to create handoff for task ${task.id}.`);
        // Continue with remaining tasks
        await runNext(tasks.slice(1));
        return;
      }

      const taskData = JSON.parse(sentinel.slice("@@RELAYOS_TASK_HANDOFF@@ ".length)) as {
        plan_id: string;
        task_id: string;
        handoff_id: string;
        title: string;
      };

      dispatch({ type: "PROJECT_PLAN_TASK_UPDATE", taskId: task.id, status: "running", handoffId: taskData.handoff_id });

      // In step mode: set as pending handoff, user must /approve each one
      if (state.mode === "step") {
        dispatch({
          type: "PENDING_HANDOFF_SET",
          handoff: { handoffId: taskData.handoff_id, title: taskData.title, needsApproval: false },
        });
        dispatch({ type: "STATUS_SET", status: "awaiting_approval" });
        appendNote(dispatch, `Task [${task.id}] handoff ready: ${taskData.handoff_id}\ntype /approve to execute, then /proceed again for the next task`);
        return; // Stop — user will /approve then /proceed again
      }

      // In build mode: auto-execute with retry loop via plan-execute-task
      appendNote(dispatch, `Build mode: executing task [${task.id}]…`);
      const execLines: string[] = [];
      await runCliCommand({
        commandName: `execute-task-${task.id}`,
        argv: ["overseer", "plan-execute-task", planId, task.id],
        dispatch: (action) => {
          if (action.type === "CLI_OUTPUT_LINE") execLines.push(action.line);
          else dispatch(action);
        },
      });
      // Parse result sentinel if present
      const resultSentinel = execLines.find((l) => l.startsWith("@@RELAYOS_TASK_RESULT@@ "));
      if (resultSentinel) {
        try {
          const resultData = JSON.parse(resultSentinel.slice("@@RELAYOS_TASK_RESULT@@ ".length)) as {
            plan_id: string;
            task_id: string;
            status: string;
            handoff_id: string;
            exit_code: number;
            retries: number;
            error_summary: string;
          };
          dispatch({
            type: "PROJECT_PLAN_TASK_UPDATE",
            taskId: task.id,
            status: resultData.status,
            handoffId: resultData.handoff_id,
          });
          if (resultData.status === "blocked") {
            appendNote(dispatch, `Task [${task.id}] blocked after ${resultData.retries} retries.`);
          }
        } catch {
          dispatch({ type: "PROJECT_PLAN_TASK_UPDATE", taskId: task.id, status: "completed" });
        }
      } else {
        dispatch({ type: "PROJECT_PLAN_TASK_UPDATE", taskId: task.id, status: "completed" });
      }

      await runNext(tasks.slice(1));
    };

    void runNext(pendingTasks);
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

    if (lower === "/proceed") {
      if (!state.projectPlan) {
        appendError(dispatch, "No active project plan. Submit a feature request first.");
      } else {
        runProceedFlow(state.projectPlan.planId);
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

    // ── answer collection mode — while awaiting plan answers ─────────────
    if (state.status === "awaiting_answers" && state.projectPlan) {
      dispatch({ type: "PROJECT_PLAN_ANSWER", answer: trimmed });
      const answerIdx = (state.projectPlan.answers?.length ?? 0) + 1;
      const totalQ = state.projectPlan.questions.length;
      if (totalQ > 0) {
        const remaining = totalQ - answerIdx;
        appendNote(dispatch,
          remaining > 0
            ? `Answer ${answerIdx}/${totalQ} recorded. ${remaining} question(s) remaining — type /proceed when ready.`
            : `All ${totalQ} question(s) answered. Type /proceed to start execution.`,
        );
      } else {
        appendNote(dispatch, `Answer recorded. Type /proceed to start execution.`);
      }
      // Persist to CLI in background so the file stays in sync
      void runCliCommand({
        commandName: "plan-answer",
        argv: ["overseer", "plan-answer", state.projectPlan.planId, trimmed],
        dispatch: () => {},
      });
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
