import type { RelayConfig } from "./schema.js";

export interface ModelProfiles {
  codexModel: string;
  codexEffort: "low" | "medium" | "high";
  claudeModel: string;
  claudeEffort: "low" | "medium" | "high";
}

const DEFAULT_PROFILES: ModelProfiles = {
  codexModel: "gpt-5.5",
  codexEffort: "high",
  claudeModel: "claude-sonnet-4-6",
  claudeEffort: "medium",
};

function normalizeEffort(input: string | undefined, fallback: ModelProfiles["codexEffort"]): ModelProfiles["codexEffort"] {
  if (input === "low" || input === "medium" || input === "high") return input;
  return fallback;
}

export function resolveModelProfiles(cfg?: RelayConfig): ModelProfiles {
  const o = cfg?.overseer;
  return {
    codexModel: o?.codex_model?.trim() || DEFAULT_PROFILES.codexModel,
    codexEffort: normalizeEffort(o?.codex_effort, DEFAULT_PROFILES.codexEffort),
    claudeModel: o?.claude_model?.trim() || DEFAULT_PROFILES.claudeModel,
    claudeEffort: normalizeEffort(o?.claude_effort, DEFAULT_PROFILES.claudeEffort),
  };
}
