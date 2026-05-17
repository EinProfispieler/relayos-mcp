import { appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface, emitKeypressEvents } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { ulid } from "ulid";
import {
  ensureOverseerDir,
  resolveOverseerLayout,
  appendHandoffResult,
  updateTaskRecord,
  readRecentTasks,
  readTaskById,
} from "./overseer.js";
import {
  ChatSessionRecord,
  type AIRoutingPlan,
  ActionIntentBlock,
  type ActionIntentBlock as ActionIntentBlockType,
} from "./schema.js";
import { type RouteDecision } from "./router.js";
import { buildActionProposal, type ActionProposal } from "./action_dispatch.js";
import { planRouteFromActionIntent } from "./ai_planner.js";
import { resolveStorageLayout, ensureStorage } from "./storage.js";
import { createAuditWriter } from "./audit.js";
import { createHandoff } from "./tools/create_handoff.js";
import { loadProjectConfig } from "./config.js";
import { handleConversation, type ConversationMessage } from "./conversation.js";
import { runSettingsWizard } from "./settings.js";
import { resolveModelProfiles } from "./model_profiles.js";
import { gitBranch, isGitRepo } from "./git.js";
import {
  blue,
  renderSlashPalette,
  renderRuntimeLine as renderRuntimeLineFromFramework,
  renderWelcome,
} from "./chat_ui_framework.js";

type ExitReason = "user_exit" | "eof" | "sigint";

interface ChatState {
  sessionId: string;
  startedAt: string;
  messageCount: number;
  currentTaskId: string | null;
  routes: Array<RouteDecision & { ai_plan: AIRoutingPlan; action_proposal: ActionProposal }>;
  conversationMessages: ConversationMessage[];
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

function buildHandoffInputFromPendingWithProfiles(
  pending: PendingActionProposal,
  codexModel: string,
  codexEffort: "low" | "medium" | "high",
) {
  const base = buildHandoffInputFromPending(pending);
  const model = pending.actionProposal.model || codexModel;
  const effort = (pending.actionProposal.effort || codexEffort) as "low" | "medium" | "high";
  return { ...base, model, effort };
}

const CHAT_USAGE = "usage: relayos chat\n";
interface ChatRuntimeOptions {
  showActionProposal?: boolean;
}

interface ParsedActionIntentReply {
  visibleReply: string;
  actionIntent: ActionIntentBlockType | null;
}

function parseBoolean(value: string): boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function parseActionIntentBlock(block: string): ActionIntentBlockType | null {
  const lines = block.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  const parsed: Record<string, string> = {};
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    parsed[key] = value;
  }

  const approval = parseBoolean(parsed.approval_required ?? "");
  const confidence = Number.parseFloat(parsed.confidence ?? "");
  const candidate = {
    intent_type: parsed.intent_type,
    confidence,
    summary: parsed.summary,
    target: parsed.target,
    model: parsed.model,
    effort: parsed.effort,
    mode: parsed.mode,
    approval_required: approval,
    suggested_next_command: parsed.suggested_next_command,
  };
  const result = ActionIntentBlock.safeParse(candidate);
  return result.success ? result.data : null;
}

export function extractActionIntentFromReply(reply: string): ParsedActionIntentReply {
  const match = reply.match(/(?:^|\n)ACTION_INTENT\s*\n([\s\S]*?)\nEND_ACTION_INTENT/);
  if (!match) return { visibleReply: reply.trimEnd(), actionIntent: null };

  const fullBlock = match[0];
  const parsed = parseActionIntentBlock(match[1] ?? "");
  const visibleReply = reply.replace(fullBlock, "\n").trim();
  return {
    visibleReply,
    actionIntent: parsed,
  };
}

function newChatSessionId(): string {
  return `chat_${ulid()}`;
}

const KNOWN_SLASH_COMMANDS = [
  "/help",
  "/status",
  "/tasks",
  "/current",
  "/result",
  "/approve",
  "/run",
  "/settings",
  "/exit",
] as const;
const SLASH_COMMAND_DESCRIPTIONS: Record<(typeof KNOWN_SLASH_COMMANDS)[number], string> = {
  "/help": "Show command help",
  "/status": "Show runtime/session summary",
  "/tasks": "Show recent task records",
  "/current": "Show current task details",
  "/result": "Show current task result summary",
  "/approve": "Approve latest action proposal",
  "/run": "Execute latest approved handoff",
  "/settings": "Open provider/model settings",
  "/exit": "Exit chat",
};

interface RuntimeView {
  projectDir: string;
  branch: string;
  codexModel: string;
  codexEffort: "low" | "medium" | "high";
  claudeModel: string;
  claudeEffort: "low" | "medium" | "high";
}

function showSlashPalette(filter: string): void {
  const normalized = filter.trim().toLowerCase();
  const palette = renderSlashPalette(
    KNOWN_SLASH_COMMANDS,
    SLASH_COMMAND_DESCRIPTIONS,
    normalized.length > 0 ? normalized : "/",
  );
  if (palette) output.write(`${palette}\n`);
}

export function buildChatHelpText(): string {
  return [
    "Slash commands:",
    "  /help      Show command help",
    "  /status    Show runtime/session summary",
    "  /tasks     Show recent task records",
    "  /current   Show current task details",
    "  /result    Show current task result summary",
    "  /approve   Approve latest action proposal",
    "  /run       Execute latest approved handoff",
    "  /settings  Open provider/model settings",
    "  /exit      Exit chat",
    "",
    "Tip: type '/' then keep typing to filter slash commands.",
  ].join("\n") + "\n";
}


function formatActionProposalCompact(proposal: ActionProposal): string[] {
  const lines = [
    `Action: ${proposal.action}`,
    `Status: ${proposal.status}`,
  ];
  if (proposal.target) lines.push(`Target: ${proposal.target}`);
  if (proposal.model) lines.push(`Model: ${proposal.model}`);
  if (proposal.effort) lines.push(`Effort: ${proposal.effort}`);
  if (proposal.mode) lines.push(`Mode: ${proposal.mode}`);
  if (proposal.approval_required !== undefined) {
    lines.push(`Approval: ${proposal.approval_required ? "required" : "not required"}`);
  }
  return lines;
}

function printStatus(
  state: ChatState,
  pendingProposal: PendingActionProposal | null,
  runtimeView: RuntimeView,
): void {
  output.write("Status\n");
  output.write("------\n");
  output.write(`${renderRuntimeLine(runtimeView, pendingProposal)}\n`);
  output.write(`session: ${state.sessionId}\n`);
  output.write(`started: ${state.startedAt}\n`);
  output.write(`messages: ${state.messageCount}\n`);
  output.write(`state: ${pendingProposal && !pendingProposal.executed ? "pending_approval" : "ready"}\n`);
  if (pendingProposal && !pendingProposal.executed) {
    output.write(`next: /approve or /run\n`);
  }
}

async function buildRuntimeView(cwd: string): Promise<RuntimeView> {
  const loaded = loadProjectConfig({ cwd });
  const profiles = resolveModelProfiles(loaded.config);
  const repo = await isGitRepo(cwd);
  const branch = repo ? await gitBranch(cwd) : null;
  const projectRoot = loaded.source ? dirname(dirname(loaded.source)) : cwd;
  const projectDir = projectRoot.split("/").filter(Boolean).slice(-1)[0] ?? ".";
  return {
    projectDir,
    branch: branch ?? "n/a",
    codexModel: profiles.codexModel,
    codexEffort: profiles.codexEffort,
    claudeModel: profiles.claudeModel,
    claudeEffort: profiles.claudeEffort,
  };
}

function renderRuntimeLine(runtimeView: RuntimeView, pending: PendingActionProposal | null): string {
  return renderRuntimeLineFromFramework(runtimeView, Boolean(pending && !pending.executed));
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
    conversation_messages: state.conversationMessages,
    exit_reason: exitReason,
  });

  const sessionsPath = `${layout.dir}/chat_sessions.jsonl`;
  await appendFile(sessionsPath, `${JSON.stringify(record)}\n`, "utf8");
}

function askLineFallback(prompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    const rl = createInterface({ input, output });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
    rl.once("close", () => resolve(null));
  });
}

function askLineWithSample2StyleTui(prompt: string): Promise<string | null> {
  if (!input.isTTY || !output.isTTY) {
    return askLineFallback(prompt);
  }

  emitKeypressEvents(input);
  input.setRawMode(true);

  return new Promise((resolve) => {
    let buffer = "";
    let done = false;
    const ttyColumns = Math.max(20, output.columns ?? 80);
    const stripAnsi = (text: string): string =>
      text.replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, "");
    const countVisualLines = (text: string): number => {
      let count = 0;
      for (const logical of text.split("\n")) {
        const visible = stripAnsi(logical);
        if (visible.length === 0) {
          count += 1;
          continue;
        }
        count += Math.max(1, Math.ceil(visible.length / ttyColumns));
      }
      return Math.max(1, count);
    };

    const render = (): void => {
      if (done) return;
      const filter = buffer.trimStart().toLowerCase();
      const palette = filter.startsWith("/")
        ? (renderSlashPalette(
          KNOWN_SLASH_COMMANDS,
          SLASH_COMMAND_DESCRIPTIONS,
          filter.length > 0 ? filter : "/",
        ) ?? "")
        : "";
      output.write("\r\u001B[2K");
      output.write(`${prompt}${buffer}`);
      output.write("\u001B[J");
      if (palette.length > 0) {
        output.write(`\n${palette}`);
        const overlayLines = countVisualLines(palette) + 1;
        output.write(`\u001B[${overlayLines}A\r`);
        output.write("\u001B[2K");
        output.write(`${prompt}${buffer}`);
      }
    };

    const finish = (value: string | null): void => {
      if (done) return;
      done = true;
      input.off("keypress", onKeypress);
      input.off("end", onEnd);
      input.setRawMode(false);
      resolve(value);
    };

    const onEnd = (): void => finish(null);

    const onKeypress = (chunk: string, key: { name?: string; ctrl?: boolean; meta?: boolean }): void => {
      if (done) return;

      if (key.ctrl && key.name === "c") {
        output.write("\n");
        finish(null);
        process.kill(process.pid, "SIGINT");
        return;
      }
      if (key.ctrl && key.name === "d") {
        if (buffer.length === 0) {
          output.write("\n");
          finish(null);
          return;
        }
      }

      if (key.name === "return" || key.name === "enter" || chunk === "\r" || chunk === "\n") {
        output.write("\r\u001B[2K");
        output.write(`${prompt}${buffer}`);
        output.write("\u001B[J");
        output.write("\n");
        finish(buffer);
        return;
      }

      if (key.name === "backspace") {
        buffer = buffer.slice(0, -1);
        render();
        return;
      }

      if (key.ctrl || key.meta) return;
      if (chunk && chunk.length > 0 && chunk >= " ") {
        buffer += chunk;
        render();
      }
    };

    input.on("keypress", onKeypress);
    input.once("end", onEnd);

    render();
  });
}

function askQuestion(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input, output });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
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
    conversationMessages: [],
  };

  let pendingProposal: PendingActionProposal | null = null;
  let sessionHandoffId: string | null = null;

  const cwd = process.cwd();
  let runtimeView = await buildRuntimeView(cwd);
  output.write(renderWelcome(runtimeView, { versionTag: "v0.6.0" }));
  const promptText = `${blue("›")} `;

  let finished = false;
  const finalize = async (reason: ExitReason): Promise<number> => {
    if (finished) return 0;
    finished = true;
    await appendSessionRecord(state, reason);
    return 0;
  };

  process.on("SIGINT", () => {
    void finalize("sigint").then((code) => {
      process.exitCode = code;
    });
  });

  while (!finished) {
    const line = await askLineWithSample2StyleTui(promptText);
    if (line === null) return finalize("eof");

    let trimmed = line.trim();
    if (trimmed === "/") {
      output.write(buildChatHelpText());
      continue;
    }
    if (trimmed.startsWith("/")) {
      const prefix = trimmed.toLowerCase();
      const hasExact = KNOWN_SLASH_COMMANDS.includes(prefix as (typeof KNOWN_SLASH_COMMANDS)[number]);
      if (!hasExact) {
        const matches = KNOWN_SLASH_COMMANDS.filter((cmd) => cmd.startsWith(prefix));
        if (matches.length === 1) {
          trimmed = matches[0]!;
        } else {
          if (matches.length === 0) {
            output.write(`unknown command: ${trimmed}\n`);
          } else {
            showSlashPalette(prefix);
          }
          continue;
        }
      } else {
        trimmed = prefix;
      }
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

      const loadedForProfiles = loadProjectConfig({ cwd: process.cwd() });
      const profiles = resolveModelProfiles(loadedForProfiles.config);
      const handoffInput = buildHandoffInputFromPendingWithProfiles(
        pendingProposal!,
        profiles.codexModel,
        profiles.codexEffort,
      );
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
    if (trimmed === "/settings") {
      await runSettingsWizard(process.cwd(), {
        write: (text) => output.write(text),
        ask: (prompt) => askQuestion(prompt),
      });
      runtimeView = await buildRuntimeView(cwd);
      continue;
    }
    if (trimmed === "/exit") {
      return finalize("user_exit");
    }

    if (trimmed === "/help") {
      output.write(buildChatHelpText());
      continue;
    }
    if (trimmed === "/status") {
      printStatus(state, pendingProposal, runtimeView);
      continue;
    }

    if (trimmed.length > 0) {
      state.messageCount += 1;
    }
    state.conversationMessages.push({ role: "user", content: line });
    const loaded = loadProjectConfig({ cwd: process.cwd() });
    const projectRoot = loaded.source ? dirname(dirname(loaded.source)) : process.cwd();
    const result = await handleConversation([{ role: "user", content: line }], loaded.config, { projectRoot });
    const parsedReply = extractActionIntentFromReply(result.reply);
    const assistantReply = parsedReply.visibleReply.length > 0 ? parsedReply.visibleReply : result.reply;
    state.conversationMessages.push({ role: "assistant", content: assistantReply });
    output.write(`${assistantReply}\n`);

    const actionIntent = parsedReply.actionIntent;
    if (!actionIntent || actionIntent.intent_type === "conversation" || actionIntent.confidence < 0.7) {
      continue;
    }

    const aiPlan = planRouteFromActionIntent(actionIntent, loaded.config);
    const actionProposal = buildActionProposal(aiPlan);
    pendingProposal = {
      originalMessage: line,
      aiPlan,
      actionProposal,
      executed: false,
    };
    state.routes.push({
      target: aiPlan.target,
      model: aiPlan.model,
      effort: aiPlan.effort as "low" | "medium" | "high",
      mode: aiPlan.mode,
      approval_required: aiPlan.approval_required,
      reason: aiPlan.reason,
      ai_plan: aiPlan,
      action_proposal: actionProposal,
    });

    if (options.showActionProposal !== false) {
      output.write("ACTION PROPOSAL:\n");
      for (const line of formatActionProposalCompact(actionProposal)) {
        output.write(`  ${line}\n`);
      }
      output.write(`${JSON.stringify(actionProposal, null, 2)}\n`);
    }
  }

  return 0;
}
