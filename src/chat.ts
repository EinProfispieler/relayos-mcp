import { appendFile } from "node:fs/promises";
import { createInterface, type Interface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { ulid } from "ulid";
import { ensureOverseerDir, resolveOverseerLayout } from "./overseer.js";
import { ChatSessionRecord, type AIRoutingPlan } from "./schema.js";
import { classifyMessage, type RouteDecision } from "./router.js";
import { safePlanRoute } from "./ai_planner.js";
import { buildActionProposal, type ActionProposal } from "./action_dispatch.js";

type ExitReason = "user_exit" | "eof" | "sigint";

interface ChatState {
  sessionId: string;
  startedAt: string;
  messageCount: number;
  routes: Array<RouteDecision & { ai_plan: AIRoutingPlan; action_proposal: ActionProposal }>;
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
  output.write("  /help   show available commands\n");
  output.write("  /status show current session info\n");
  output.write("  /exit   write session record and exit\n");
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

export async function runChat(args: string[], options: ChatRuntimeOptions = {}): Promise<number> {
  if (args.length > 0) {
    process.stderr.write(CHAT_USAGE);
    return 1;
  }

  const state: ChatState = {
    sessionId: newChatSessionId(),
    startedAt: new Date().toISOString(),
    messageCount: 0,
    routes: [],
  };

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
    state.routes.push({ ...decision, ai_plan: aiPlan, action_proposal: actionProposal });
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
