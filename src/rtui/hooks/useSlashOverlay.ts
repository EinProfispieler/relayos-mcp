import { useMemo } from "react";
import { useRTUI } from "../state/context.js";
import { filterCommands, isSelectable, type SlashCommand } from "../commands/registry.js";

export interface SlashOverlayApi {
  visible: boolean;
  query: string;
  filtered: readonly SlashCommand[];
  selectedIndex: number;
  selectableCount: number;
  open: () => void;
  close: () => void;
  setQuery: (query: string) => void;
  move: (delta: number) => void;
  select: () => SlashCommand | null;
}

export function useSlashOverlay(): SlashOverlayApi {
  const { state, dispatch } = useRTUI();
  const { palette } = state;
  const filtered = useMemo(() => filterCommands(palette.query), [palette.query]);

  return {
    visible: palette.visible,
    query: palette.query,
    filtered,
    selectedIndex: Math.min(palette.selectedIndex, Math.max(0, filtered.length - 1)),
    selectableCount: filtered.filter(isSelectable).length,
    open: () => dispatch({ type: "SLASH_OPEN" }),
    close: () => dispatch({ type: "SLASH_CLOSE" }),
    setQuery: (query: string) => dispatch({ type: "SLASH_QUERY", query }),
    move: (delta: number) =>
      dispatch({ type: "SLASH_MOVE", delta, visibleCount: filtered.length }),
    select: () => {
      const cmd = filtered[Math.min(palette.selectedIndex, filtered.length - 1)];
      if (!cmd || !isSelectable(cmd)) return null;
      return cmd;
    },
  };
}
