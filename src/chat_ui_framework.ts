import { stdout as output } from "node:process";

export type ChatCommand =
  | "/help"
  | "/status"
  | "/tasks"
  | "/current"
  | "/result"
  | "/approve"
  | "/run"
  | "/settings"
  | "/exit";

export interface ChatRuntimeView {
  projectDir: string;
  branch: string;
  codexModel: string;
  codexEffort: "low" | "medium" | "high";
}

export interface ChatUiOptions {
  versionTag: string;
}

function ansi(code: string, text: string): string {
  return `\u001B[${code}m${text}\u001B[0m`;
}

export function cyan(text: string): string {
  return ansi("96", text);
}

export function green(text: string): string {
  return ansi("92", text);
}

export function blue(text: string): string {
  return ansi("94", text);
}

export function dim(text: string): string {
  return ansi("90", text);
}

export function yellow(text: string): string {
  return ansi("93", text);
}

export function magenta(text: string): string {
  return ansi("95", text);
}

export function pendingStateLabel(hasPending: boolean): string {
  return hasPending ? "Pending" : "Ready";
}

export function renderRuntimeLine(view: ChatRuntimeView, hasPending: boolean): string {
  return [
    `${view.codexModel} ${view.codexEffort}`,
    `${green(`~/${view.projectDir}`)}`,
    `${blue(view.branch)}`,
    `${magenta(pendingStateLabel(hasPending))}`,
    `${dim("Context 100% left")}`,
    `${dim("5h 77%")}`,
    `${dim("weekly 5%")}`,
  ].join(dim(" · "));
}

export function renderWelcome(view: ChatRuntimeView, options: ChatUiOptions): string {
  const boxTop = "╭──────────────────────────────────────────────────────────────";
  const boxBottom = "╰──────────────────────────────────────────────────────────────";
  const title = `│ ${blue(">_")} ${blue("RelayOS Chat")} ${dim(`(${options.versionTag})`)}`;
  const profile = `│ model:     ${view.codexModel}  (effort: ${view.codexEffort})`;
  const directory = `│ directory: ~/${view.projectDir}`;
  const branch = `│ branch:    ${view.branch}`;
  return [
    `${green("❯")} ${dim("relays")}`,
    "",
    boxTop,
    title,
    profile,
    directory,
    branch,
    boxBottom,
    "",
    `${blue("Tip:")} Use ${cyan("/help")} for commands, ${cyan("/settings")} for provider setup.`,
    `${yellow("⚠ Heads up:")} Use ${cyan("/status")} for runtime breakdown and recent task summary.`,
    "",
    `${blue("›")} Try ${cyan("/tasks")} for recent tasks`,
    "",
    `${blue("›")} ${dim('Try "improve documentation in README.md"')}`,
    "",
  ].join("\n");
}

export function renderSlashPalette(
  commands: readonly ChatCommand[],
  descriptions: Record<ChatCommand, string>,
  filter = "/",
): string {
  const prefix = filter.trim().toLowerCase();
  const items = commands.filter((cmd) => cmd.startsWith(prefix.length > 0 ? prefix : "/"));
  if (items.length === 0) return "";
  const width = 60;
  const line = "─".repeat(width);
  return [
    `╭${line}╮`,
    `│ ${blue("Slash Commands")} ${dim(prefix ? `(filter: ${prefix})` : "")}`,
    `├${line}┤`,
    ...items.map((cmd) => `│ ${cyan(cmd.padEnd(10, " "))} ${descriptions[cmd]}`),
    `╰${line}╯`,
  ].join("\n");
}

export function buildChatHelpText(): string {
  return [
    "Slash commands:",
    "  /help      Show this help",
    "  /status    Show runtime/session summary",
    "  /tasks     Show recent task records",
    "  /current   Show current task details",
    "  /result    Show current task result summary",
    "  /approve   Approve latest action proposal",
    "  /run       Execute latest approved handoff",
    "  /settings  Open provider/model settings",
    "  /exit      Exit chat",
    "",
    "Quick map:",
    "  Session: /help /status /exit",
    "  Tasks:   /tasks /current /result",
    "  Actions: /approve /run",
    "  Config:  /settings",
    "",
    "Input routing: non-slash input is treated as AI conversation.",
  ].join("\n") + "\n";
}

// Samplecode-inspired transient status block manager.
// Mirrors the clearStatusLines strategy used in samplecode bridge UI.
export function createTransientBlockRenderer(write: (chunk: string) => void) {
  let statusLineCount = 0;

  function countVisualLines(text: string): number {
    const cols = Math.max(20, output.columns ?? 80);
    let count = 0;
    for (const logical of text.split("\n")) {
      if (logical.length === 0) {
        count += 1;
        continue;
      }
      count += Math.max(1, Math.ceil(logical.length / cols));
    }
    if (text.endsWith("\n")) count -= 1;
    return Math.max(0, count);
  }

  function writeStatus(text: string): void {
    write(text);
    statusLineCount += countVisualLines(text);
  }

  function clearStatusLines(): void {
    if (statusLineCount <= 0) return;
    write(`\x1b[${statusLineCount}A`);
    write("\x1b[J");
    statusLineCount = 0;
  }

  function printLog(line: string): void {
    clearStatusLines();
    write(line);
  }

  return {
    writeStatus,
    clearStatusLines,
    printLog,
  };
}

export function createSlashOverlayController(args: {
  write: (chunk: string) => void;
  isTTY: boolean;
  commands: readonly ChatCommand[];
  descriptions: Record<ChatCommand, string>;
}) {
  let visible = false;
  let enteredSlashMode = false;

  function clear(): void {
    if (!visible || !args.isTTY) return;
    // Save cursor, clear everything below prompt line, then restore cursor.
    // Use DEC save/restore for broader terminal compatibility.
    args.write("\u001B7");
    args.write("\u001B[1B");
    args.write("\u001B[J");
    args.write("\u001B8");
    visible = false;
    enteredSlashMode = false;
  }

  function refresh(inputLine: string): void {
    if (!args.isTTY) return;
    const filter = inputLine.trimStart().toLowerCase();
    if (!filter.startsWith("/")) {
      clear();
      return;
    }
    if (visible || enteredSlashMode) return;

    const palette = renderSlashPalette(args.commands, args.descriptions, "/");
    if (!palette) {
      clear();
      return;
    }

    args.write("\u001B7");
    args.write("\n");
    args.write(palette);
    args.write("\u001B8");
    visible = true;
    enteredSlashMode = true;
  }

  return {
    clear,
    refresh,
  };
}
