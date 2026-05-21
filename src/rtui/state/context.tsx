import { createContext, useContext, useMemo, useReducer, type ReactNode } from "react";
import type { RTUIAction, RTUIState, RuntimeView } from "./types.js";
import { initialState, reducer } from "./store.js";

interface RTUIContextValue {
  state: RTUIState;
  dispatch: (action: RTUIAction) => void;
}

const RTUIContext = createContext<RTUIContextValue | null>(null);

interface ProviderProps {
  runtime: RuntimeView;
  children: ReactNode;
}

export function RTUIProvider({ runtime, children }: ProviderProps) {
  const [state, dispatch] = useReducer(reducer, runtime, initialState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <RTUIContext.Provider value={value}>{children}</RTUIContext.Provider>;
}

export function useRTUI(): RTUIContextValue {
  const ctx = useContext(RTUIContext);
  if (ctx === null) {
    throw new Error("useRTUI must be called inside <RTUIProvider>");
  }
  return ctx;
}
