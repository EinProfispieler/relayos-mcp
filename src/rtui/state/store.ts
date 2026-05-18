import type { ChatMode, RTUIAction, RTUIState, RuntimeView, ScrollbackItem } from "./types.js";

const HISTORY_LIMIT = 500;

function newSessionId(): string {
  return `rtui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function newItemId(): string {
  return `cli-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function initialState(runtime: RuntimeView): RTUIState {
  return {
    session: {
      id: newSessionId(),
      startedAt: new Date().toISOString(),
      messageCount: 0,
    },
    runtime,
    scrollback: [],
    live: { spinner: null, streaming: null, progress: null },
    input: { value: "", cursor: 0, history: [], historyIndex: null },
    status: "idle",
    palette: { visible: false, query: "", selectedIndex: 0 },
    cli: { running: null, queue: [], streamingLines: [] },
    settingsOpen: false,
    wizardOpen: false,
    mode: "step" as ChatMode,
    pendingHandoff: null,
    projectPlan: null,
  };
}

export function reducer(state: RTUIState, action: RTUIAction): RTUIState {
  switch (action.type) {
    case "INPUT_CHANGED":
      return {
        ...state,
        input: { ...state.input, value: action.value, cursor: action.cursor, historyIndex: null },
      };

    case "INPUT_SUBMITTED": {
      const trimmed = state.input.value;
      if (trimmed.length === 0) return state;
      const dedupedHistory =
        state.input.history[0] === trimmed
          ? state.input.history
          : [trimmed, ...state.input.history].slice(0, HISTORY_LIMIT);
      return {
        ...state,
        input: {
          value: "",
          cursor: 0,
          history: dedupedHistory,
          historyIndex: null,
        },
        session: { ...state.session, messageCount: state.session.messageCount + 1 },
      };
    }

    case "HISTORY_PREV": {
      const { history, historyIndex } = state.input;
      if (history.length === 0) return state;
      const nextIndex =
        historyIndex === null ? 0 : Math.min(historyIndex + 1, history.length - 1);
      const value = history[nextIndex] ?? "";
      return {
        ...state,
        input: { ...state.input, value, cursor: value.length, historyIndex: nextIndex },
      };
    }

    case "HISTORY_NEXT": {
      const { history, historyIndex } = state.input;
      if (historyIndex === null) return state;
      const nextIndex = historyIndex - 1;
      if (nextIndex < 0) {
        return {
          ...state,
          input: { ...state.input, value: "", cursor: 0, historyIndex: null },
        };
      }
      const value = history[nextIndex] ?? "";
      return {
        ...state,
        input: { ...state.input, value, cursor: value.length, historyIndex: nextIndex },
      };
    }

    case "SCROLLBACK_APPEND":
      return { ...state, scrollback: [...state.scrollback, action.item] };

    case "LIVE_SET_SPINNER":
      return { ...state, live: { ...state.live, spinner: action.spinner } };

    case "LIVE_SET_STREAM":
      return { ...state, live: { ...state.live, streaming: action.text } };

    case "LIVE_CLEAR":
      return { ...state, live: { spinner: null, streaming: null, progress: null } };

    case "STATUS_SET":
      return { ...state, status: action.status };

    case "RUNTIME_UPDATED":
      return { ...state, runtime: action.runtime };

    case "SLASH_OPEN":
      return {
        ...state,
        palette: { visible: true, query: "", selectedIndex: 0 },
      };

    case "SLASH_QUERY":
      return {
        ...state,
        palette: { ...state.palette, query: action.query, selectedIndex: 0 },
      };

    case "SLASH_CLOSE":
      return {
        ...state,
        palette: { visible: false, query: "", selectedIndex: 0 },
      };

    case "SLASH_MOVE": {
      if (action.visibleCount <= 0) {
        return { ...state, palette: { ...state.palette, selectedIndex: 0 } };
      }
      const next = Math.max(
        0,
        Math.min(action.visibleCount - 1, state.palette.selectedIndex + action.delta),
      );
      return { ...state, palette: { ...state.palette, selectedIndex: next } };
    }

    case "CLI_COMMAND_START":
      return {
        ...state,
        cli: {
          running: { commandName: action.commandName, argv: action.argv },
          queue: state.cli.queue,
          streamingLines: [],
        },
      };

    case "CLI_COMMAND_QUEUE":
      return {
        ...state,
        cli: {
          ...state.cli,
          queue: [...state.cli.queue, { commandName: action.commandName, argv: action.argv }],
        },
      };

    case "CLI_OUTPUT_LINE":
      return {
        ...state,
        cli: { ...state.cli, streamingLines: [...state.cli.streamingLines, action.line] },
      };

    case "CLI_COMMAND_COMPLETE": {
      const flushed: ScrollbackItem[] = state.cli.streamingLines.map((line) => ({
        id: newItemId(),
        type: "system_note" as const,
        text: line,
      }));
      if (action.exitCode !== 0) {
        flushed.push({
          id: newItemId(),
          type: "error" as const,
          text: `(exit ${action.exitCode})`,
        });
      }
      const [nextRunning, ...restQueue] = state.cli.queue;
      return {
        ...state,
        scrollback: [...state.scrollback, ...flushed],
        cli: {
          running: nextRunning ?? null,
          queue: restQueue,
          streamingLines: [],
        },
      };
    }

    case "SETTINGS_OPEN":
      return { ...state, settingsOpen: true };

    case "SETTINGS_CLOSE":
      return { ...state, settingsOpen: false };

    case "WIZARD_OPEN":
      return { ...state, wizardOpen: true };

    case "WIZARD_CLOSE":
      return { ...state, wizardOpen: false };

    case "MODE_SET":
      return { ...state, mode: action.mode };

    case "PENDING_HANDOFF_SET":
      return { ...state, pendingHandoff: action.handoff };

    case "PENDING_HANDOFF_CLEAR":
      return { ...state, pendingHandoff: null };

    case "PROJECT_PLAN_SET":
      return { ...state, projectPlan: action.plan };

    case "PROJECT_PLAN_CLEAR":
      return { ...state, projectPlan: null };

    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}
