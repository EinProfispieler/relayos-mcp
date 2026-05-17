import type { RTUIAction, RTUIState, RuntimeView } from "./types.js";

const HISTORY_LIMIT = 500;

function newSessionId(): string {
  return `rtui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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

    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}
