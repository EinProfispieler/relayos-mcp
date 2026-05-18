import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadProjectConfig } from "../../../config.js";
import { RelayConfig } from "../../../schema.js";
import { encryptConfigSecret } from "../../../secret_crypto.js";
import { ensureProjectConfigSecret } from "../../../config_secret.js";
import { buildOverseerFromPool } from "../../../overseer_config.js";
import type { SettingsDraft, PoolEntry, Effort, Provider } from "./types.js";
import {
  normalizeProviderName,
  defaultApiBase,
  EFFORT_STEPS,
} from "./providerHelpers.js";

// Re-export for wizard convenience
export type { SettingsDraft, PoolEntry, Effort, Provider };

function dedupePoolByProvider(pool: PoolEntry[]): PoolEntry[] {
  const seen = new Set<string>();
  const out: PoolEntry[] = [];
  for (const p of pool) {
    if (seen.has(p.name)) continue;
    seen.add(p.name);
    out.push(p);
  }
  return out;
}

function normalizePoolWithPrimary(primary: SettingsDraft, pool: PoolEntry[]): PoolEntry[] {
  const primaryEntry: PoolEntry = {
    id: "p1",
    name: primary.provider,
    kind: primary.kind,
    model: primary.model,
    effort: primary.provider === "glm" ? "medium" : primary.effort,
    api_base: primary.kind === "api" ? primary.api_base : undefined,
    api_key_env: primary.kind === "api" ? primary.api_key_env : undefined,
  };
  const restSeed = pool.filter((p) => p.name !== primary.provider);
  const usedIds = new Set(restSeed.map((p) => p.id));
  const ensureUniqueId = (base: string): string => {
    if (!usedIds.has(base)) {
      usedIds.add(base);
      return base;
    }
    let i = 2;
    while (usedIds.has(`${base}_${i}`)) i += 1;
    const id = `${base}_${i}`;
    usedIds.add(id);
    return id;
  };
  const rest = restSeed.map((p) => {
    if (p.id === "p1") return { ...p, id: ensureUniqueId(`p_${p.name}`) };
    return p;
  });
  return [primaryEntry, ...dedupePoolByProvider(rest)];
}

export function resolveWritePath(cwd: string): string {
  const loaded = loadProjectConfig({ cwd });
  if (loaded.source) return loaded.source;
  return join(resolve(cwd), ".relayos", "config.json");
}

export function loadDraft(cwd: string): { draft: SettingsDraft; pool: PoolEntry[]; orderIds: string[] } {
  const loaded = loadProjectConfig({ cwd });
  const overseer = loaded.config.overseer;
  const providerObj = overseer?.provider && typeof overseer.provider === "object" ? overseer.provider : null;
  const providerRaw = (providerObj?.name ?? overseer?.provider ?? "codex").toString();
  const provider = normalizeProviderName(providerRaw);
  const kindRaw = (providerObj?.kind ?? overseer?.kind ?? "subscription_cli").toString();
  const kind = kindRaw === "api" ? "api" as const : "subscription_cli" as const;
  const model = (providerObj?.model ?? overseer?.model ?? (provider === "claude" ? "claude-sonnet-4-6" : provider === "glm" ? "GLM-5.1" : "gpt-5.5")).toString();
  const effortRaw = (providerObj?.effort ?? overseer?.effort ?? "medium").toString();
  const effort: Effort = EFFORT_STEPS.includes(effortRaw as Effort) ? (effortRaw as Effort) : "medium";
  const api_base = (providerObj?.api_base ?? overseer?.api_base ?? defaultApiBase(provider)).toString();
  const api_key_env = (providerObj?.api_key_env ?? overseer?.api_key_env ?? "").toString();
  const hasSavedEncryptedKey =
    (typeof providerObj?.api_key_enc === "string" && providerObj.api_key_enc.trim().length > 0) ||
    (Array.isArray(overseer?.providers) &&
      overseer.providers.some((p) => p.id === overseer?.primary_provider && typeof p.api_key_enc === "string" && p.api_key_enc.trim().length > 0));

  const providersRaw = Array.isArray(overseer?.providers) ? overseer?.providers : [];
  const pool: PoolEntry[] = providersRaw
    .filter((p) => typeof p === "object" && p !== null)
    .map((p) => p as Record<string, unknown>)
    .map((p, idx) => {
      const name = normalizeProviderName(String(p.name ?? "codex"));
      const pkind = String(p.kind ?? "subscription_cli") === "api" ? "api" as const : "subscription_cli" as const;
      const peffortRaw = String(p.effort ?? "medium");
      const peffort: Effort = EFFORT_STEPS.includes(peffortRaw as Effort) ? (peffortRaw as Effort) : "medium";
      return {
        id: String(p.id ?? `p${idx + 1}`),
        name,
        kind: pkind,
        model: String(p.model ?? (name === "claude" ? "claude-sonnet-4-6" : name === "glm" ? "GLM-5.1" : "gpt-5.5")),
        effort: peffort,
        api_base: typeof p.api_base === "string" ? p.api_base : undefined,
        api_key_env: typeof p.api_key_env === "string" ? p.api_key_env : undefined,
      };
    })
    .slice(0, 4);
  const dedupedPool = dedupePoolByProvider(pool);

  if (dedupedPool.length === 0) {
    dedupedPool.push({
      id: "p1",
      name: provider,
      kind,
      model,
      effort,
      api_base: kind === "api" ? api_base : undefined,
      api_key_env: kind === "api" ? api_key_env : undefined,
    });
  }

  const primary = typeof overseer?.primary_provider === "string" ? overseer.primary_provider : dedupedPool[0]?.id;
  const backups = Array.isArray(overseer?.backup_providers) ? overseer.backup_providers.filter((x): x is string => typeof x === "string") : [];
  const orderSeed = [primary, ...backups].filter((x): x is string => typeof x === "string");
  const normalizedPool = normalizePoolWithPrimary(
    {
      provider,
      kind,
      model,
      effort,
      api_base,
      api_key_env,
      api_key: "",
      has_saved_encrypted_key: hasSavedEncryptedKey,
    },
    dedupedPool,
  );
  const orderIds = [...new Set([...orderSeed, ...normalizedPool.map((p) => p.id)])].filter((id) => normalizedPool.some((p) => p.id === id));

  return {
    draft: {
      provider,
      kind,
      model,
      effort,
      api_base,
      api_key_env,
      api_key: "",
      has_saved_encrypted_key: hasSavedEncryptedKey,
    },
    pool: normalizedPool,
    orderIds,
  };
}

export function saveDraft(cwd: string, draft: SettingsDraft, pool: PoolEntry[], orderIds: string[]): string {
  const path = resolveWritePath(cwd);
  const prev = existsSync(path) ? RelayConfig.parse(JSON.parse(readFileSync(path, "utf8"))) : RelayConfig.parse({});
  const secret = ensureProjectConfigSecret(cwd);
  const apiMode = draft.kind === "api";
  const providerName = draft.provider;
  const primaryEffort: Effort =
    providerName === "glm"
      ? "medium"
      : providerName === "codex" && draft.effort === "max"
      ? "xhigh"
      : draft.effort;
  const command = providerName === "claude" ? "claude" : "codex";
  const args = providerName === "claude"
    ? ["-p", "{{input}}", "--model", "{{model}}"]
    : ["exec", "--model", "{{model}}", "-c", "model_reasoning_effort={{effort}}", "--sandbox", "read-only", "{{input}}"];

  const uniquePool = normalizePoolWithPrimary(draft, pool);
  const primaryRecord: Record<string, unknown> = {
    id: "p1",
    name: providerName,
    kind: draft.kind,
    model: draft.model,
    effort: primaryEffort,
    timeout_ms: 120000,
    ...(draft.kind === "subscription_cli"
      ? {
          execution_mode: "subscription_cli",
          command,
          args,
        }
      : {
          api_base: draft.api_base,
          api_format: providerName === "claude" ? "anthropic_messages" : "openai_compatible",
          ...(draft.api_key_env.trim().length > 0 ? { api_key_env: draft.api_key_env.trim() } : {}),
        }),
  };

  if (apiMode && draft.api_key.trim().length > 0) {
    if (secret.length === 0) {
      throw new Error("RELAYOS_CONFIG_SECRET is required to save api_key.");
    }
    primaryRecord.api_key_enc = encryptConfigSecret(draft.api_key.trim(), secret);
  }
  const nextProviders = [
    primaryRecord,
    ...uniquePool
      .filter((p) => p.id !== "p1" && p.name !== providerName)
      .map((p) => ({
        id: p.id,
        name: p.name,
        kind: p.kind,
        model: p.model,
        effort:
          p.name === "glm"
            ? "medium"
            : p.name === "codex" && p.effort === "max"
            ? "xhigh"
            : p.effort,
        timeout_ms: 120000,
        ...(p.kind === "subscription_cli"
          ? {
              execution_mode: "subscription_cli",
              command: p.name === "claude" ? "claude" : "codex",
              args:
                p.name === "claude"
                  ? ["-p", "{{input}}", "--model", "{{model}}"]
                  : ["exec", "--model", "{{model}}", "-c", "model_reasoning_effort={{effort}}", "--sandbox", "read-only", "{{input}}"],
            }
          : {
              api_base: p.api_base ?? defaultApiBase(p.name),
              api_format: p.name === "claude" ? "anthropic_messages" : "openai_compatible",
              ...(p.api_key_env && p.api_key_env.trim().length > 0 ? { api_key_env: p.api_key_env.trim() } : {}),
            }),
      })),
  ];

  const validOrder = orderIds.filter((id) => nextProviders.some((p) => String((p as Record<string, unknown>).id) === id));
  const dedupedOrder = [...new Set(validOrder)];
  const primaryId = dedupedOrder[0] ?? "p1";
  const backupIds = dedupedOrder.slice(1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nextOverseer = buildOverseerFromPool(prev.overseer, nextProviders as any, primaryId, backupIds);

  const next = RelayConfig.parse({
    ...prev,
    overseer: {
      ...nextOverseer,
    },
  });

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return path;
}
