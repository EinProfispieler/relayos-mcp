import type { Provider, Effort } from "./types.js";

export const EFFORT_STEPS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"] as const;
export const CODEX_EFFORT_STEPS: readonly Effort[] = ["low", "medium", "high", "xhigh"] as const;

export function defaultApiBase(provider: Provider): string {
  if (provider === "claude") return "https://api.anthropic.com/v1";
  if (provider === "glm") return "https://open.bigmodel.cn/api/coding/paas/v4";
  return "https://api.openai.com/v1";
}

export function defaultModelsForProvider(provider: Provider): string[] {
  if (provider === "claude") return ["claude-sonnet-4-6", "claude-opus-4-1"];
  if (provider === "glm") return ["GLM-5.1", "GLM-5-Turbo", "GLM-4.7", "GLM-4.5-Air"];
  return ["gpt-5.5", "gpt-5.4", "gpt-5.3-codex"];
}

export function effortStepsForProvider(provider: Provider): readonly Effort[] {
  if (provider === "claude") return EFFORT_STEPS;
  if (provider === "codex") return CODEX_EFFORT_STEPS;
  return [];
}

export function cycle<T>(list: readonly T[], current: T, delta: number): T {
  const idx = list.indexOf(current);
  const next = (idx + delta + list.length) % list.length;
  return list[next] ?? current;
}

export function ensureModelInList(list: string[], model: string): string[] {
  if (list.includes(model)) return list;
  return [model, ...list];
}

export function apiBaseOptionsForProvider(provider: Provider): string[] {
  if (provider === "glm") {
    return [
      "https://open.bigmodel.cn/api/coding/paas/v4",
      "https://open.bigmodel.cn/api/paas/v4",
      "https://api.z.ai/api/coding/paas/v4",
    ];
  }
  if (provider === "claude") return ["https://api.anthropic.com/v1"];
  return ["https://api.openai.com/v1"];
}

export function apiBaseLabel(provider: Provider, apiBase: string): string {
  const normalized = apiBase.replace(/\/+$/, "");
  if (provider === "glm") {
    if (normalized === "https://open.bigmodel.cn/api/coding/paas/v4") return "GLM API (Plan CN)";
    if (normalized === "https://open.bigmodel.cn/api/paas/v4") return "GLM API (Metered CN)";
    if (normalized === "https://api.z.ai/api/coding/paas/v4") return "z.AI API (Global)";
  }
  if (provider === "claude" && normalized === "https://api.anthropic.com/v1") return "Claude API";
  if (provider === "codex" && normalized === "https://api.openai.com/v1") return "OpenAI API";
  return apiBase;
}

export function normalizeProviderName(raw: string): Provider {
  const value = raw.toLowerCase();
  if (value.includes("claude") || value.includes("anthropic")) return "claude";
  if (value.includes("glm") || value.includes("zhipu")) return "glm";
  return "codex";
}
