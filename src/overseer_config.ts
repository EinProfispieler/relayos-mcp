import type { RelayConfig } from "./schema.js";

type ProviderKind = "subscription" | "api" | "fallback" | "subscription_cli" | "local_command";
type ProviderEntry = {
  id: string;
  name: string;
  kind: ProviderKind;
  model: string;
  effort?: string;
  execution_mode?: string;
  command?: string;
  args?: string[];
  timeout_ms?: number;
  api_base?: string;
  api_key?: string;
  api_key_env?: string;
  api_key_enc?: string;
  api_format?: "openai_compatible" | "anthropic_messages";
};

function canonicalProviderName(raw: string): string {
  const v = raw.trim().toLowerCase();
  if (v.includes("claude") || v.includes("anthropic")) return "claude";
  if (v.includes("glm") || v.includes("zhipu") || v.includes("z.ai")) return "glm";
  if (v.includes("codex") || v.includes("openai")) return "codex";
  return v;
}

function normalizeEffort(providerName: string, effort?: string): string {
  const p = canonicalProviderName(providerName);
  if (p === "glm") return "medium";
  const e = (effort ?? "medium").trim().toLowerCase();
  if (p === "codex" && e === "max") return "xhigh";
  return e.length > 0 ? e : "medium";
}

function dedupeProviders(entries: ProviderEntry[]): ProviderEntry[] {
  const out: ProviderEntry[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const key = canonicalProviderName(e.name);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...e,
      name: key,
      effort: normalizeEffort(key, e.effort),
    });
  }
  return out;
}

export function normalizeProviderPool(
  providers: ProviderEntry[],
  preferredOrderIds: string[],
): { providers: ProviderEntry[]; primaryId: string; backupIds: string[] } {
  const deduped = dedupeProviders(providers);
  const byId = new Map(deduped.map((p) => [p.id, p]));
  const ordered: ProviderEntry[] = [];
  const usedProvider = new Set<string>();

  for (const id of preferredOrderIds) {
    const p = byId.get(id);
    if (!p) continue;
    const key = canonicalProviderName(p.name);
    if (usedProvider.has(key)) continue;
    usedProvider.add(key);
    ordered.push(p);
  }

  for (const p of deduped) {
    const key = canonicalProviderName(p.name);
    if (usedProvider.has(key)) continue;
    usedProvider.add(key);
    ordered.push(p);
  }

  if (ordered.length === 0) {
    throw new Error("providers list is empty after normalization");
  }

  return {
    providers: ordered,
    primaryId: ordered[0]!.id,
    backupIds: ordered.slice(1).map((p) => p.id),
  };
}

export function buildOverseerFromPool(
  prevOverseer: RelayConfig["overseer"] | undefined,
  providers: ProviderEntry[],
  primaryId: string,
  backupIds: string[],
): NonNullable<RelayConfig["overseer"]> {
  const normalized = normalizeProviderPool(providers, [primaryId, ...backupIds]);
  const primary = normalized.providers[0]!;
  const execution_mode = primary.kind === "api" ? "local_command" : "subscription_cli";

  const providerSummary = {
    name: primary.name,
    kind: primary.kind,
    model: primary.model,
    effort: normalizeEffort(primary.name, primary.effort),
    ...(primary.execution_mode ? { execution_mode: primary.execution_mode } : {}),
    ...(primary.command ? { command: primary.command } : {}),
    ...(primary.args ? { args: primary.args } : {}),
    ...(primary.timeout_ms ? { timeout_ms: primary.timeout_ms } : {}),
    ...(primary.api_base ? { api_base: primary.api_base } : {}),
    ...(primary.api_key ? { api_key: primary.api_key } : {}),
    ...(primary.api_key_env ? { api_key_env: primary.api_key_env } : {}),
    ...(primary.api_key_enc ? { api_key_enc: primary.api_key_enc } : {}),
    ...(primary.api_format ? { api_format: primary.api_format } : {}),
  };

  return {
    ...(prevOverseer ?? {}),
    providers: normalized.providers,
    primary_provider: normalized.primaryId,
    backup_providers: normalized.backupIds,
    provider: providerSummary,
    kind: primary.kind,
    model: primary.model,
    effort: normalizeEffort(primary.name, primary.effort),
    execution_mode,
    timeout_ms: primary.timeout_ms ?? prevOverseer?.timeout_ms ?? 120000,
    ...(primary.command ? { command: primary.command } : {}),
    ...(primary.args ? { args: primary.args } : {}),
    ...(primary.api_base ? { api_base: primary.api_base } : {}),
    ...(primary.api_key ? { api_key: primary.api_key } : {}),
    ...(primary.api_key_env ? { api_key_env: primary.api_key_env } : {}),
    ...(primary.api_format ? { api_format: primary.api_format } : {}),
  };
}
