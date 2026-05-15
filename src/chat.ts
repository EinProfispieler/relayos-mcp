import { appendFile } from "node:fs/promises";
import { createInterface, type Interface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { ulid } from "ulid";
import { ensureOverseerDir, resolveOverseerLayout } from "./overseer.js";
import { ChatSessionRecord } from "./schema.js";

type ExitReason = "user_exit" | "eof" | "sigint";

interface ChatState {
  sessionId: string;
  startedAt: string;
  messageCount: number;
}

const CHAT_USAGE = "usage: relayos chat\n";

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

export async function runChat(args: string[]): Promise<number> {
  if (args.length > 0) {
    process.stderr.write(CHAT_USAGE);
    return 1;
  }

  const state: ChatState = {
    sessionId: newChatSessionId(),
    startedAt: new Date().toISOString(),
    messageCount: 0,
  };

  output.write("RelayOS Chat - type /help for commands\n");

  const rl = createInterface({ input, output, prompt: "> " });

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
    output.write(`[not connected] ${line}\n`);
  }

  return 0;
}
