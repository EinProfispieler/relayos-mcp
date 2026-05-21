// Semantic color tokens for RTUI. Centralized so future /theme work
// (out of Phase 0 scope) has a single file to swap.

export const colors = {
  prompt: "cyan",
  user: "white",
  assistant: "white",
  system: "gray",
  error: "red",
  pending: "magenta",
  ready: "green",
  thinking: "yellow",
  branch: "blue",
  dim: "gray",
  accent: "cyan",
} as const;

export type ColorKey = keyof typeof colors;
