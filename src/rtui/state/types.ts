export type EffortLevel = "low" | "medium" | "high";

export type Status =
  | "idle"
  | "thinking"
  | "awaiting_approval"
  | "executing";

export interface RuntimeView {
  projectDir: string;
  branch: string;
  model: string;
  effort: EffortLevel;
  isGitRepo: boolean;
}

export interface SessionInfo {
  id: string;
  startedAt: string;
  messageCount: number;
}

export type ScrollbackItem =
  | { id: string; type: "user_input"; text: string }
  | { id: string; type: "assistant_text"; text: string }
  | { id: string; type: "system_note"; text: string }
  | { id: string; type: "error"; text: string }
  | { id: string; type: "divider" };

export interface LiveState {
  spinner: string | null;
  streaming: string | null;
  progress: number | null;
}

export interface InputState {
  value: string;
  cursor: number;
  history: string[];
  historyIndex: number | null;
}

export interface PaletteState {
  visible: boolean;
  query: string;
  selectedIndex: number;
}

export interface CliCommandRef {
  commandName: string;
  argv: readonly string[];
}

export interface CliState {
  running: CliCommandRef | null;
  queue: readonly CliCommandRef[];
  streamingLines: readonly string[];
}

export interface RTUIState {
  session: SessionInfo;
  runtime: RuntimeView;
  scrollback: ScrollbackItem[];
  live: LiveState;
  input: InputState;
  status: Status;
  palette: PaletteState;
  cli: CliState;
}

export type RTUIAction =
  | { type: "INPUT_CHANGED"; value: string; cursor: number }
  | { type: "INPUT_SUBMITTED" }
  | { type: "HISTORY_PREV" }
  | { type: "HISTORY_NEXT" }
  | { type: "SCROLLBACK_APPEND"; item: ScrollbackItem }
  | { type: "LIVE_SET_SPINNER"; spinner: string | null }
  | { type: "LIVE_SET_STREAM"; text: string | null }
  | { type: "LIVE_CLEAR" }
  | { type: "STATUS_SET"; status: Status }
  | { type: "RUNTIME_UPDATED"; runtime: RuntimeView }
  | { type: "SLASH_OPEN" }
  | { type: "SLASH_QUERY"; query: string }
  | { type: "SLASH_CLOSE" }
  | { type: "SLASH_MOVE"; delta: number; visibleCount: number }
  | { type: "CLI_COMMAND_START"; commandName: string; argv: readonly string[] }
  | { type: "CLI_COMMAND_QUEUE"; commandName: string; argv: readonly string[] }
  | { type: "CLI_OUTPUT_LINE"; line: string }
  | { type: "CLI_COMMAND_COMPLETE"; exitCode: number };
