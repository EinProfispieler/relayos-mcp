import type { PlanReportData } from "../../project_plan.js";

export type { PlanReportData };

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export type Status =
  | "idle"
  | "thinking"
  | "awaiting_approval"
  | "awaiting_answers"
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

export interface ProjectPlanTaskView {
  id: string;
  title: string;
  target: string;
  model: string;
  effort: string;
  mode: string;
  status: string;
  handoffId?: string;
}

export interface ProjectPlanView {
  planId: string;
  goal: string;
  questions: string[];
  answers: string[];
  tasks: ProjectPlanTaskView[];
}

export type ScrollbackItem =
  | { id: string; type: "user_input"; text: string }
  | { id: string; type: "assistant_text"; text: string }
  | { id: string; type: "system_note"; text: string }
  | { id: string; type: "timing_note"; ms: number }
  | { id: string; type: "error"; text: string }
  | { id: string; type: "plan_summary"; plan: ProjectPlanView }
  | { id: string; type: "plan_report"; data: PlanReportData }
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

export type ChatMode = "step" | "build";

export interface PendingHandoff {
  handoffId: string;
  title: string;
  needsApproval: boolean;
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
  settingsOpen: boolean;
  wizardOpen: boolean;
  mode: ChatMode;
  pendingHandoff: PendingHandoff | null;
  projectPlan: ProjectPlanView | null;
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
  | { type: "CLI_COMMAND_COMPLETE"; exitCode: number }
  | { type: "SETTINGS_OPEN" }
  | { type: "SETTINGS_CLOSE" }
  | { type: "WIZARD_OPEN" }
  | { type: "WIZARD_CLOSE" }
  | { type: "MODE_SET"; mode: ChatMode }
  | { type: "PENDING_HANDOFF_SET"; handoff: PendingHandoff }
  | { type: "PENDING_HANDOFF_CLEAR" }
  | { type: "PROJECT_PLAN_SET"; plan: ProjectPlanView }
  | { type: "PROJECT_PLAN_CLEAR" }
  | { type: "PROJECT_PLAN_ANSWER"; answer: string }
  | { type: "PROJECT_PLAN_TASK_UPDATE"; taskId: string; status: string; handoffId?: string };
