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

function normalizeModelId(input: string | undefined, fallback: string): string {
  const raw = (input ?? "").trim();
  if (raw.length === 0) return fallback;
  const lower = raw.toLowerCase().replace(/\s+/g, "");
  if (lower === "gpt5.5" || lower === "gpt-55" || lower === "gpt55") return "gpt-5.5";
  if (lower === "gpt5.4" || lower === "gpt-54" || lower === "gpt54") return "gpt-5.4";
  if (lower === "gpt5.3-codex" || lower === "gpt53-codex" || lower === "gpt-53-codex") {
    return "gpt-5.3-codex";
  }
  return raw;
}

function normalizeEffort(input: string | undefined, fallback: ModelProfiles["codexEffort"]): ModelProfiles["codexEffort"] {
  if (input === "low" || input === "medium" || input === "high") return input;
  return fallback;
}

export function resolveModelProfiles(cfg?: RelayConfig): ModelProfiles {
  const o = cfg?.overseer;
  return {
    codexModel: normalizeModelId(o?.codex_model, DEFAULT_PROFILES.codexModel),
    codexEffort: normalizeEffort(o?.codex_effort, DEFAULT_PROFILES.codexEffort),
    claudeModel: normalizeModelId(o?.claude_model, DEFAULT_PROFILES.claudeModel),
    claudeEffort: normalizeEffort(o?.claude_effort, DEFAULT_PROFILES.claudeEffort),
  };
}
