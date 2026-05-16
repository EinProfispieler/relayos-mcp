import { appendFile } from "node:fs/promises";
import { createInterface, type Interface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { ulid } from "ulid";
import {
  ensureOverseerDir,
  resolveOverseerLayout,
  appendHandoffResult,
  appendTaskRecord,
  updateTaskRecord,
  readRecentTasks,
  readTaskById,
} from "./overseer.js";
import { ChatSessionRecord, type AIRoutingPlan, type TaskRecord } from "./schema.js";
import { classifyMessage, type RouteDecision } from "./router.js";
import { safePlanRoute } from "./ai_planner.js";
import { buildActionProposal, type ActionProposal } from "./action_dispatch.js";
import { resolveStorageLayout, ensureStorage } from "./storage.js";
import { createAuditWriter } from "./audit.js";
import { createHandoff } from "./tools/create_handoff.js";

type ExitReason = "user_exit" | "eof" | "sigint";

interface ChatState {
  sessionId: string;
  startedAt: string;
  messageCount: number;
  currentTaskId: string | null;
  routes: Array<RouteDecision & { ai_plan: AIRoutingPlan; action_proposal: ActionProposal }>;
}

export interface PendingActionProposal {
  originalMessage: string;
  aiPlan: AIRoutingPlan;
  actionProposal: ActionProposal;
  executed: boolean;
}

export function resolveRunHandoffId(
  sessionHandoffId: string | null,
): { handoffId: string | null; errorMessage: string | null } {
  if (!sessionHandoffId) {
    return {
      handoffId: null,
      errorMessage: "No handoff created in this session. Use /approve first.",
    };
  }
  return { handoffId: sessionHandoffId, errorMessage: null };
}

export function decideApproveAction(
  pending: PendingActionProposal | null,
): "create_handoff" | "blocked" | "none" {
  if (!pending || pending.executed) return "none";
  if (pending.actionProposal.action === "request_approval") return "blocked";
  if (
    pending.actionProposal.action === "create_handoff" &&
    pending.actionProposal.target === "codex" &&
    pending.actionProposal.status === "not_executed"
  ) {
    return "create_handoff";
  }
  return "none";
}

function toTaskTitle(message: string): string {
  const cleaned = message.replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 80) || "Untitled task";
}

export function buildHandoffInputFromPending(pending: PendingActionProposal): {
  source_agent: "claude";
  target_agent: "codex";
  model: string;
  effort: "low" | "medium" | "high";
  execution_mode: "patch";
  task_title: string;
  task_description: string;
  expected_output: string[];
  auto_spawn: false;
} {
  const model = pending.actionProposal.model || "gpt-5.3-codex";
  const effort = (pending.actionProposal.effort || "medium") as "low" | "medium" | "high";
  const proposalLines = [
    `action: ${pending.actionProposal.action}`,
    `target: ${pending.actionProposal.target ?? "n/a"}`,
    `model: ${pending.actionProposal.model ?? "n/a"}`,
    `effort: ${pending.actionProposal.effort ?? "n/a"}`,
    `mode: ${pending.actionProposal.mode ?? "n/a"}`,
    `status: ${pending.actionProposal.status}`,
  ];

  return {
    source_agent: "claude",
    target_agent: "codex",
    model,
    effort,
    execution_mode: "patch",
    task_title: toTaskTitle(pending.originalMessage),
    task_description: [
      "Original user message:",
      pending.originalMessage,
      "",
      "AI plan summary:",
      `task_type: ${pending.aiPlan.task_type}`,
      `target: ${pending.aiPlan.target}`,
      `model: ${pending.aiPlan.model}`,
      `effort: ${pending.aiPlan.effort}`,
      `mode: ${pending.aiPlan.mode}`,
      `reason: ${pending.aiPlan.reason}`,
      `next_action: ${pending.aiPlan.next_action}`,
      "",
      "Action proposal:",
      ...proposalLines,
    ].join("\n"),
    expected_output: ["Patch applied", "Tests pass"],
    auto_spawn: false,
  };
}

const CHAT_USAGE = "usage: relayos chat\n";
interface ChatRuntimeOptions {
  showActionProposal?: boolean;
}

function newChatSessionId(): string {
  return `chat_${ulid()}`;
}

function printHelp(): void {
  output.write("Available commands:\n");
  output.write("  /help    show available commands\n");
  output.write("  /status  show current session info\n");
  output.write("  /tasks   show recent tasks\n");
  output.write("  /current show current task details\n");
  output.write("  /result  show current task result summary\n");
  output.write("  /approve approve latest action proposal\n");
  output.write("  /run     execute latest open handoff via execute-handoff\n");
  output.write("  /exit    write session record and exit\n");
}

function printStatus(state: ChatState): void {
  output.write(`session_id: ${state.sessionId}\n`);
  output.write(`started_at: ${state.startedAt}\n`);
  output.write(`message_count: ${state.messageCount}\n`);
}

async function appendSessionRecord(state: ChatState, exitReason: ExitReason): Promise<void> {
  const layout = resolveOverseerLayout(process.cwd());
  await ensureOverseerDir(layout);

  const record = ChatSessionRecord.parse({
    session_id: state.sessionId,
    started_at: state.startedAt,
    ended_at: new Date().toISOString(),
    message_count: state.messageCount,
    routes: state.routes,
    exit_reason: exitReason,
  });

  const sessionsPath = `${layout.dir}/chat_sessions.jsonl`;
  await appendFile(sessionsPath, `${JSON.stringify(record)}\n`, "utf8");
}

function askLine(rl: Interface): Promise<string | null> {
  return new Promise((resolve) => {
    const onLine = (line: string): void => {
      cleanup();
      resolve(line);
    };
    const onClose = (): void => {
      cleanup();
      resolve(null);
    };
    const cleanup = (): void => {
      rl.off("line", onLine);
      rl.off("close", onClose);
    };

    rl.once("line", onLine);
    rl.once("close", onClose);
    rl.prompt();
  });
}

async function runExecuteHandoffFromCli(
  handoffId: string,
  io: { stdout: { write: (chunk: string) => unknown }; stderr: { write: (chunk: string) => unknown } },
): Promise<number> {
  const mod = await import("./cli.js");
  return mod.runOverseerExecuteHandoffById(handoffId, io);
}

export async function runChat(args: string[], options: ChatRuntimeOptions = {}): Promise<number> {
  if (args.length > 0) {
    process.stderr.write(CHAT_USAGE);
    return 1;
  }

  const state: ChatState = {
    sessionId: newChatSessionId(),
    startedAt: new Date().toISOString(),
    messageCount: 0,
    currentTaskId: null,
    routes: [],
  };

  let pendingProposal: PendingActionProposal | null = null;
  let sessionHandoffId: string | null = null;

  output.write("RelayOS Chat - type /help for commands\n");

  const rl = createInterface({ input, output, prompt: "RelayOS Overseer > " });

  let finished = false;
  const finalize = async (reason: ExitReason): Promise<number> => {
    if (finished) return 0;
    finished = true;
    rl.close();
    await appendSessionRecord(state, reason);
    return 0;
  };

  process.on("SIGINT", () => {
    void finalize("sigint").then((code) => {
      process.exitCode = code;
    });
  });

  while (!finished) {
    const line = await askLine(rl);
    if (line === null) return finalize("eof");

    const trimmed = line.trim();
    if (trimmed === "/help") {
      printHelp();
      continue;
    }
    if (trimmed === "/status") {
      printStatus(state);
      continue;
    }
    if (trimmed === "/tasks") {
      const overseerLayout = resolveOverseerLayout(process.cwd());
      const tasks = await readRecentTasks(overseerLayout, 10);
      output.write(`Recent tasks (project: ${process.cwd()}):\n`);
      for (const task of tasks) {
        const summary = task.user_input.length > 60
          ? `${task.user_input.slice(0, 57)}...`
          : task.user_input;
        output.write(`  ${task.task_id}  ${task.status}  ${task.created_at}  ${summary}\n`);
      }
      continue;
    }
    if (trimmed === "/current") {
      if (!state.currentTaskId) {
        output.write("No current task.\n");
        continue;
      }
      const overseerLayout = resolveOverseerLayout(process.cwd());
      const task = await readTaskById(overseerLayout, state.currentTaskId);
      if (!task) {
        output.write("No current task.\n");
        continue;
      }
      output.write(`${JSON.stringify(task, null, 2)}\n`);
      continue;
    }
    if (trimmed === "/result") {
      if (!state.currentTaskId) {
        output.write("No result available.\n");
        continue;
      }
      const overseerLayout = resolveOverseerLayout(process.cwd());
      const task = await readTaskById(overseerLayout, state.currentTaskId);
      if (!task?.result_summary) {
        output.write("No result available.\n");
        continue;
      }
      output.write(`${task.result_summary}\n`);
      continue;
    }
    if (trimmed === "/approve") {
      const approval = decideApproveAction(pendingProposal);
      if (approval === "none") {
        output.write("No pending action proposal to approve.\n");
        continue;
      }
      if (approval === "blocked") {
        output.write(
          "BLOCKED: Release actions require manual approval. No commit/push/tag/release will be executed. Future release flow not yet implemented.\n",
        );
        continue;
      }

      const handoffInput = buildHandoffInputFromPending(pendingProposal!);
      const storageLayout = resolveStorageLayout();
      await ensureStorage(storageLayout);
      const audit = createAuditWriter(storageLayout);
      const handoffResult = await createHandoff(handoffInput, { layout: storageLayout, audit });
      sessionHandoffId = handoffResult.handoff_id;
      const overseerLayout = resolveOverseerLayout(process.cwd());
      if (state.currentTaskId) {
        try {
          await updateTaskRecord(overseerLayout, state.currentTaskId, {
            handoff_id: handoffResult.handoff_id,
            status: "approved",
            updated_at: new Date().toISOString(),
          });
        } catch (error) {
          output.write(`Task registry update failed: ${String(error)}\n`);
        }
      }
      await appendHandoffResult(overseerLayout, {
        run_id: handoffResult.handoff_id,
        status: "completed",
        summary: `Handoff created for: ${pendingProposal!.originalMessage}`,
      });

      pendingProposal!.executed = true;

      output.write("HANDOFF CREATED:\n");
      output.write(`  id:     ${handoffResult.handoff_id}\n`);
      output.write("  worker: codex\n");
      output.write(`  model:  ${handoffInput.model}\n`);
      output.write(`  effort: ${handoffInput.effort}\n`);
      output.write("  status: recorded\n");
      output.write(`  next:   relayos overseer execute-handoff ${handoffResult.handoff_id}\n`);
      continue;
    }
    if (trimmed === "/run") {
      const runTarget = resolveRunHandoffId(sessionHandoffId);
      if (!runTarget.handoffId) {
        output.write(`${runTarget.errorMessage}\n`);
        continue;
      }
      const overseerLayout = resolveOverseerLayout(process.cwd());
      if (state.currentTaskId) {
        try {
          await updateTaskRecord(overseerLayout, state.currentTaskId, {
            status: "running",
            updated_at: new Date().toISOString(),
          });
        } catch (error) {
          output.write(`Task registry update failed: ${String(error)}\n`);
        }
      }
      output.write(`Executing session handoff: ${runTarget.handoffId}\n`);
      const exitCode = await runExecuteHandoffFromCli(
        runTarget.handoffId,
        { stdout: output, stderr: output },
      );
      if (state.currentTaskId) {
        try {
          await updateTaskRecord(overseerLayout, state.currentTaskId, {
            status: exitCode === 0 ? "completed" : "failed",
            result_summary:
              exitCode === 0
                ? `Handoff executed: ${runTarget.handoffId}`
                : "Execution failed",
            updated_at: new Date().toISOString(),
          });
        } catch (error) {
          output.write(`Task registry update failed: ${String(error)}\n`);
        }
      }
      output.write(`Execution result: ${exitCode === 0 ? "completed" : "failed"}\n`);
      continue;
    }
    if (trimmed === "/exit") {
      return finalize("user_exit");
    }

    if (trimmed.startsWith("/")) {
      output.write(`unknown command: ${trimmed}\n`);
      continue;
    }

    if (trimmed.length > 0) {
      state.messageCount += 1;
    }
    const decision = classifyMessage(line);
    const aiPlan = safePlanRoute(line, decision);
    const actionProposal = buildActionProposal(aiPlan);
    const now = new Date().toISOString();
    const taskId = ulid();
    const task: TaskRecord = {
      task_id: taskId,
      user_input: line,
      route: decision,
      ai_plan: aiPlan,
      action_proposal: actionProposal,
      status: "pending",
      created_at: now,
      updated_at: now,
    };
    const overseerLayout = resolveOverseerLayout(process.cwd());
    void appendTaskRecord(overseerLayout, task).catch((error) => {
      output.write(`Task registry write failed: ${String(error)}\n`);
    });
    state.currentTaskId = taskId;
    pendingProposal = {
      originalMessage: line,
      aiPlan,
      actionProposal,
      executed: false,
    };
    state.routes.push({ ...decision, ai_plan: aiPlan, action_proposal: actionProposal });
    output.write(`task: ${taskId}\n`);
    output.write("[ROUTE]\n");
    output.write(`  target:            ${decision.target}\n`);
    output.write(`  model:             ${decision.model}\n`);
    output.write(`  effort:            ${decision.effort}\n`);
    output.write(`  mode:              ${decision.mode}\n`);
    output.write(`  approval_required: ${decision.approval_required}\n`);
    output.write(`  reason:            ${decision.reason}\n`);
    if (decision.approval_required) {
      output.write("  ⚠ approval required before execution\n");
    }
    output.write("[AI PLAN]\n");
    output.write(`  task_type:         ${aiPlan.task_type}\n`);
    output.write(`  target:            ${aiPlan.target}\n`);
    output.write(`  model:             ${aiPlan.model}\n`);
    output.write(`  effort:            ${aiPlan.effort}\n`);
    output.write(`  mode:              ${aiPlan.mode}\n`);
    output.write(`  approval_required: ${aiPlan.approval_required}\n`);
    output.write(`  confidence:        ${aiPlan.confidence}\n`);
    output.write(`  reason:            ${aiPlan.reason}\n`);
    output.write(`  next_action:       ${aiPlan.next_action}\n`);
    if (options.showActionProposal !== false) {
      output.write("ACTION PROPOSAL:\n");
      output.write(`  action: ${actionProposal.action}\n`);
      if (actionProposal.target) output.write(`  target: ${actionProposal.target}\n`);
      if (actionProposal.model) output.write(`  model: ${actionProposal.model}\n`);
      if (actionProposal.effort) output.write(`  effort: ${actionProposal.effort}\n`);
      if (actionProposal.mode) output.write(`  mode: ${actionProposal.mode}\n`);
      if (typeof actionProposal.approval_required === "boolean") {
        output.write(`  approval_required: ${actionProposal.approval_required}\n`);
      }
      output.write(`  status: ${actionProposal.status}\n`);
    }
  }

  return 0;
}
