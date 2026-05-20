import { appendFile, mkdir, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import type { RelayConfig } from "./schema.js";
import { decryptConfigSecret } from "./secret_crypto.js";
import { getProjectConfigSecret } from "./config_secret.js";
import { OVERSEER_ROLE_TEXT } from "./overseer/role.js";

export interface ConversationProvider {
  chat(messages: ConversationMessage[]): Promise<string>;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ConversationResult {
  reply: string;
  providerUsed: string | null;
  configured: boolean;
}

export interface ConversationScope {
  projectRoot: string;
  /** Skip the pre/post snapshot mutation guard (for read-only turns already sandboxed). */
  skipMutationGuard?: boolean;
}

interface ResolvedConversationProviderConfig {
  id?: string;
  provider: string;
  kind: "subscription" | "api" | "fallback" | "subscription_cli" | "local_command";
  model: string;
  effort: string | null;
  executionMode: string | null;
  command: string | null;
  args: string[];
  timeoutMs: number;
  apiBase: string | null;
  apiKey: string | null;
  apiKeyEnc: string | null;
  apiKeyEnv: string | null;
  apiFormat: "openai_compatible" | "anthropic_messages" | null;
}

interface ProviderCooldownState {
  providers: Record<string, { blocked_until: string; reason: string; updated_at: string }>;
}

const PROVIDER_COOLDOWN_FILE = "provider_cooldowns.json";

function normalizeModelId(input: string): string {
  const raw = input.trim();
  const lower = raw.toLowerCase().replace(/\s+/g, "");
  if (lower === "gpt5.5" || lower === "gpt-55" || lower === "gpt55") return "gpt-5.5";
  if (lower === "gpt5.4" || lower === "gpt-54" || lower === "gpt54") return "gpt-5.4";
  if (lower === "gpt5.3-codex" || lower === "gpt53-codex" || lower === "gpt-53-codex") {
    return "gpt-5.3-codex";
  }
  return raw;
}

class ConfiguredConversationProvider implements ConversationProvider {
  constructor(
    private readonly cfg: ResolvedConversationProviderConfig,
    private readonly scope: ConversationScope,
  ) {}

  async chat(messages: ConversationMessage[]): Promise<string> {
    const latestUser = [...messages].reverse().find((m) => m.role === "user");
    const providerLabel = `${this.cfg.provider}/${this.cfg.model} [${this.cfg.kind}]`;
    if (!latestUser) {
      return `provider-configured-but-not-executable: ${providerLabel} configured, but no user message was provided.`;
    }
    if (this.cfg.kind === "api") {
      return runApiProvider(this.cfg, this.scope, messages, providerLabel);
    }
    if (!isExecutableMode(this.cfg.executionMode) || !this.cfg.command) {
      return `provider-configured-but-not-executable: ${providerLabel} is configured, but no executable command is set for execution_mode local_command/subscription_cli.`;
    }
    return runLocalCommandProvider(this.cfg, this.scope, latestUser.content, providerLabel);
  }
}

function resolveApiKey(cfg: ResolvedConversationProviderConfig, scope: ConversationScope): string | null {
  if (cfg.apiKey && cfg.apiKey.trim().length > 0) return cfg.apiKey.trim();
  if (cfg.apiKeyEnc && cfg.apiKeyEnc.trim().length > 0) {
    const secret = getProjectConfigSecret(scope.projectRoot);
    if (typeof secret === "string" && secret.trim().length > 0) {
      try {
        const plain = decryptConfigSecret(cfg.apiKeyEnc, secret);
        if (plain.trim().length > 0) return plain.trim();
      } catch {
        // continue to other resolution paths
      }
    }
  }
  if (cfg.apiKeyEnv && cfg.apiKeyEnv.trim().length > 0) {
    const fromEnv = process.env[cfg.apiKeyEnv.trim()];
    if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return fromEnv.trim();
  }
  return null;
}

function inferApiFormat(cfg: ResolvedConversationProviderConfig): "openai_compatible" | "anthropic_messages" {
  if (cfg.apiFormat) return cfg.apiFormat;
  const lower = cfg.provider.toLowerCase();
  if (lower.includes("claude") || lower.includes("anthropic")) return "anthropic_messages";
  return "openai_compatible";
}

function resolveApiBase(cfg: ResolvedConversationProviderConfig): string {
  if (cfg.apiBase && cfg.apiBase.trim().length > 0) return cfg.apiBase.trim();
  const p = cfg.provider.toLowerCase();
  if (p.includes("claude") || p.includes("anthropic")) return "https://api.anthropic.com/v1";
  if (p.includes("glm") || p.includes("zhipu")) return "https://open.bigmodel.cn/api/coding/paas/v4";
  if (p.includes("kimi") || p.includes("moonshot")) return "https://api.moonshot.cn/v1";
  return "https://api.openai.com/v1";
}

function buildEndpoint(base: string, format: "openai_compatible" | "anthropic_messages"): string {
  const cleaned = base.replace(/\/+$/, "");
  if (cleaned.endsWith("/chat/completions") || cleaned.endsWith("/messages")) return cleaned;
  if (format === "anthropic_messages") return `${cleaned}/messages`;
  return `${cleaned}/chat/completions`;
}

async function runApiProvider(
  cfg: ResolvedConversationProviderConfig,
  scope: ConversationScope,
  messages: ConversationMessage[],
  providerLabel: string,
): Promise<string> {
  const apiKey = resolveApiKey(cfg, scope);
  if (!apiKey) {
    return `provider-execution-failed: ${providerLabel} api key is missing (set api_key or api_key_env).`;
  }
  const format = inferApiFormat(cfg);
  const base = resolveApiBase(cfg);
  const endpoint = buildEndpoint(base, format);

  // Build the overseer system prompt — same identity + context as CLI providers.
  // Append routing/action-intent instructions so API providers can also emit ACTION_INTENT.
  const overseerContext = await buildOverseerContextBundle(scope.projectRoot);
  const systemPrompt = [
    overseerContext,
    "",
    "=== OPERATING INSTRUCTIONS ===",
    `- Allowed context is only the current project/worktree root: ${scope.projectRoot}`,
    "- Do not read, cite, summarize, or rely on files outside this project/worktree.",
    "- Do not edit files. Do not run shell commands.",
    "- Do not claim any tests/builds/commands were executed.",
    "- Always return a normal human-facing answer.",
    "- If the user appears to be asking for project work, you may append one optional ACTION_INTENT block at the end.",
    "- PROVIDER ROUTING GUIDANCE — target by task fit:",
    "  - codex: implementation, patches, refactors, writing/running tests.",
    "  - claude: review, planning, code analysis, explanation, documentation.",
    "  - overseer: discussion, clarification, no agent dispatch.",
    "- ACTION_INTENT format (optional, at end of reply):",
    "ACTION_INTENT",
    "intent_type: conversation | create_task | create_handoff | review | release_control | project_plan",
    "confidence: 0.0-1.0",
    "summary: one-line description",
    "target: codex | claude | overseer",
    "model: <model id>",
    "effort: low | medium | high | xhigh | max",
    "mode: patch | plan | review | test",
    "approval_required: true | false",
    "END_ACTION_INTENT",
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    if (format === "anthropic_messages") {
      const latestUser = [...messages].reverse().find((m) => m.role === "user");
      const userText = latestUser?.content ?? "";
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: "user", content: userText }],
        }),
        signal: controller.signal,
      });
      if (!resp.ok) {
        const text = (await resp.text()).slice(0, 500);
        return `provider-execution-failed: ${providerLabel} HTTP ${resp.status}; detail: ${text}`;
      }
      const json = (await resp.json()) as { content?: Array<{ type?: string; text?: string }> };
      const text = json.content?.find((c) => c.type === "text")?.text?.trim();
      return text && text.length > 0 ? text : `provider-execution-failed: ${providerLabel} empty response.`;
    }

    // openai_compatible (GLM, OpenAI-compatible APIs): prepend system message
    const apiMessages = [
      { role: "system" as const, content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: apiMessages,
        temperature: 0.2,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = (await resp.text()).slice(0, 500);
      return `provider-execution-failed: ${providerLabel} HTTP ${resp.status}; detail: ${text}`;
    }
    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content?.trim();
    return text && text.length > 0 ? text : `provider-execution-failed: ${providerLabel} empty response.`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `provider-execution-failed: ${providerLabel} request error; detail: ${msg}`;
  } finally {
    clearTimeout(timer);
  }
}

function isExecutableMode(mode: string | null): boolean {
  return mode === "local_command" || mode === "subscription_cli";
}

function isCodexCommand(command: string): boolean {
  const trimmed = command.trim();
  return trimmed === "codex" || trimmed.endsWith("/codex");
}

function hasArg(args: string[], flag: string): boolean {
  return args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
}

function applyReadOnlyConversationArgs(cfg: ResolvedConversationProviderConfig, args: string[]): string[] {
  if (cfg.executionMode !== "subscription_cli" || !isCodexCommand(cfg.command ?? "")) return args;
  const out = [...args];
  if (!hasArg(out, "--sandbox")) {
    const insertAt = out.length >= 1 ? 1 : 0;
    out.splice(insertAt, 0, "--sandbox", "read-only");
  }
  return out;
}

type SnapshotEntry = { kind: "file"; content: Buffer } | { kind: "dir" };

async function walkRelative(root: string, rel = ""): Promise<string[]> {
  const abs = rel.length > 0 ? join(root, rel) : root;
  const entries = await readdir(abs, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const childRel = rel.length > 0 ? join(rel, entry.name) : entry.name;
    out.push(childRel);
    if (entry.isDirectory()) {
      out.push(...await walkRelative(root, childRel));
    }
  }
  return out;
}

async function snapshotProjectTree(projectRoot: string): Promise<Map<string, SnapshotEntry>> {
  const snapshot = new Map<string, SnapshotEntry>();
  const relPaths = await walkRelative(projectRoot);
  for (const rel of relPaths) {
    const abs = join(projectRoot, rel);
    const s = await stat(abs);
    if (s.isDirectory()) {
      snapshot.set(rel, { kind: "dir" });
      continue;
    }
    if (s.isFile()) {
      snapshot.set(rel, { kind: "file", content: await readFile(abs) });
    }
  }
  return snapshot;
}

async function rollbackProjectMutations(projectRoot: string, before: Map<string, SnapshotEntry>): Promise<boolean> {
  const afterPaths = new Set(await walkRelative(projectRoot));
  const beforePaths = new Set(before.keys());
  let changed = false;

  for (const rel of afterPaths) {
    const beforeEntry = before.get(rel);
    if (!beforeEntry) {
      changed = true;
      const abs = join(projectRoot, rel);
      const s = await stat(abs);
      if (s.isDirectory()) {
        await rm(abs, { recursive: true, force: true });
      } else {
        await unlink(abs).catch(() => undefined);
      }
      continue;
    }
    if (beforeEntry.kind === "file") {
      const abs = join(projectRoot, rel);
      const s = await stat(abs);
      if (!s.isFile()) {
        changed = true;
        await rm(abs, { recursive: true, force: true });
        await writeFile(abs, beforeEntry.content);
        continue;
      }
      const now = await readFile(abs);
      if (!now.equals(beforeEntry.content)) {
        changed = true;
        await writeFile(abs, beforeEntry.content);
      }
    }
  }

  for (const rel of beforePaths) {
    if (afterPaths.has(rel)) continue;
    const beforeEntry = before.get(rel);
    if (!beforeEntry) continue;
    changed = true;
    const abs = join(projectRoot, rel);
    if (beforeEntry.kind === "dir") {
      await mkdir(abs, { recursive: true });
    } else {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, beforeEntry.content);
    }
  }

  return changed;
}

async function runLocalCommandProvider(
  cfg: ResolvedConversationProviderConfig,
  scope: ConversationScope,
  userMessage: string,
  providerLabel: string,
): Promise<string> {
  const effort = cfg.effort ?? "medium";
  const scopedInput = await buildScopedProviderInput(scope.projectRoot, userMessage);
  const hasInputPlaceholder = cfg.args.some((arg) => arg.includes("{{input}}"));
  const argv = cfg.args.map((arg) =>
    arg
      .replaceAll("{{input}}", scopedInput)
      .replaceAll("{{model}}", cfg.model)
      .replaceAll("{{effort}}", effort)
  );
  const safeArgv = applyReadOnlyConversationArgs(cfg, argv);

  // subscription_cli is typically non-interactive and should not wait on stdin.
  // If no {{input}} placeholder exists, pass user input as a positional arg.
  if (cfg.executionMode === "subscription_cli" && !hasInputPlaceholder) {
    safeArgv.push(scopedInput);
  }

  const useStdin = cfg.executionMode === "local_command" && !hasInputPlaceholder;
  const shouldPipeAndCloseStdin = cfg.executionMode === "subscription_cli" || useStdin;

  const before = scope.skipMutationGuard ? null : await snapshotProjectTree(scope.projectRoot);
  const result = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    spawnError: string | null;
  }>((resolve) => {
    const child = spawn(cfg.command as string, safeArgv, {
      shell: false,
      stdio: [shouldPipeAndCloseStdin ? "pipe" : "ignore", "pipe", "pipe"],
      windowsHide: true,
      cwd: scope.projectRoot,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let spawnError: string | null = null;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 250).unref?.();
    }, cfg.timeoutMs);

    if (child.stdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
    }
    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
    }
    child.on("error", (error) => {
      spawnError = error.message;
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut, spawnError });
    });

    if (child.stdin) {
      if (useStdin) child.stdin.end(`${scopedInput}\n`);
      else child.stdin.end();
    }
  });

  const mutated = before ? await rollbackProjectMutations(scope.projectRoot, before) : false;
  if (mutated && result.code === 0 && !result.timedOut && !result.spawnError && result.stdout.trim().length > 0) {
    const safeNotice =
      "\n\n[safety] provider attempted to modify project files during conversation mode; changes were rolled back.";
    return `${result.stdout.trimEnd()}${safeNotice}`;
  }
  if (mutated) {
    return `provider-execution-failed: ${providerLabel} attempted to modify project files during conversation mode; changes were rolled back`;
  }

  if (result.code === 0 && !result.timedOut && !result.spawnError) {
    return result.stdout.trimEnd();
  }

  const reason = result.timedOut
    ? `timed out after ${cfg.timeoutMs}ms`
    : result.spawnError
    ? `spawn error: ${result.spawnError}`
    : `exit code ${result.code ?? "unknown"}${result.signal ? ` (signal ${result.signal})` : ""}`;
  const detail = result.stderr.trim() || result.stdout.trim();
  const suffix = detail.length > 0 ? `; detail: ${detail.slice(0, 400)}` : "";
  return `provider-execution-failed: ${providerLabel} ${reason}${suffix}`;
}

function resolveConversationProviderConfig(
  config: RelayConfig,
): ResolvedConversationProviderConfig | null {
  const providerValue = config.overseer?.provider;
  const fallbackName = typeof providerValue === "string" ? providerValue.trim() : null;
  const providerName = typeof providerValue === "object"
    ? providerValue.name.trim()
    : fallbackName;
  const model = typeof providerValue === "object"
    ? providerValue.model.trim()
    : config.overseer?.model?.trim();
  const kind = typeof providerValue === "object"
    ? providerValue.kind
    : config.overseer?.kind;

  if (!providerName || !model || !kind) return null;
  const effort = typeof providerValue === "object"
    ? providerValue.effort?.trim() ?? null
    : config.overseer?.effort?.trim() ?? null;
  const executionMode = typeof providerValue === "object"
    ? providerValue.execution_mode?.trim() ?? null
    : config.overseer?.execution_mode?.trim() ?? null;
  const command = typeof providerValue === "object"
    ? providerValue.command?.trim() ?? null
    : config.overseer?.command?.trim() ?? null;
  const args = typeof providerValue === "object"
    ? providerValue.args ?? []
    : config.overseer?.args ?? [];
  const timeoutMs = typeof providerValue === "object"
    ? providerValue.timeout_ms ?? 120000
    : config.overseer?.timeout_ms ?? 120000;
  const apiBase = typeof providerValue === "object"
    ? providerValue.api_base?.trim() ?? null
    : config.overseer?.api_base?.trim() ?? null;
  const apiKey = typeof providerValue === "object"
    ? providerValue.api_key?.trim() ?? null
    : config.overseer?.api_key?.trim() ?? null;
  const apiKeyEnc = typeof providerValue === "object"
    ? providerValue.api_key_enc?.trim() ?? null
    : null;
  const apiKeyEnv = typeof providerValue === "object"
    ? providerValue.api_key_env?.trim() ?? null
    : config.overseer?.api_key_env?.trim() ?? null;
  const apiFormat = typeof providerValue === "object"
    ? providerValue.api_format ?? null
    : config.overseer?.api_format ?? null;
  return {
    provider: providerName,
    kind,
    model: normalizeModelId(model),
    effort,
    executionMode,
    command,
    args,
    timeoutMs,
    apiBase,
    apiKey,
    apiKeyEnc,
    apiKeyEnv,
    apiFormat,
  };
}

function resolveConversationProviderConfigs(config: RelayConfig): ResolvedConversationProviderConfig[] {
  const providers = config.overseer?.providers;
  if (!providers || providers.length === 0) {
    const single = resolveConversationProviderConfig(config);
    return single ? [single] : [];
  }
  const byId = new Map<string, ResolvedConversationProviderConfig>();
  for (const p of providers) {
    byId.set(p.id, {
      id: p.id,
      provider: p.name,
      kind: p.kind,
      model: normalizeModelId(p.model),
      effort: p.effort?.trim() ?? null,
      executionMode: p.execution_mode?.trim() ?? null,
      command: p.command?.trim() ?? null,
      args: p.args ?? [],
      timeoutMs: p.timeout_ms ?? 120000,
      apiBase: p.api_base?.trim() ?? null,
      apiKey: p.api_key?.trim() ?? null,
      apiKeyEnc: p.api_key_enc?.trim() ?? null,
      apiKeyEnv: p.api_key_env?.trim() ?? null,
      apiFormat: p.api_format ?? null,
    });
  }
  const orderedIds = [
    ...(config.overseer?.primary_provider ? [config.overseer.primary_provider] : []),
    ...(config.overseer?.backup_providers ?? []),
  ];
  const out: ResolvedConversationProviderConfig[] = [];
  const seen = new Set<string>();
  for (const id of orderedIds) {
    const cfg = byId.get(id);
    if (!cfg || seen.has(id)) continue;
    out.push(cfg);
    seen.add(id);
  }
  for (const p of providers) {
    if (seen.has(p.id)) continue;
    const cfg = byId.get(p.id);
    if (cfg) out.push(cfg);
  }
  return out;
}

function isFallbackEligibleFailure(reply: string): boolean {
  const lower = reply.toLowerCase();
  if (!lower.startsWith("provider-execution-failed:")) return false;
  return (
    lower.includes("http 429") ||
    lower.includes("rate limit") ||
    lower.includes("quota") ||
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("fetch failed") ||
    lower.includes("request error") ||
    lower.includes("network")
  );
}

function isUsageLimitFailure(reply: string): boolean {
  const lower = reply.toLowerCase();
  return (
    lower.includes("usage limit") ||
    lower.includes("max usage") ||
    lower.includes("rate limit reached") ||
    lower.includes("try again in") ||
    lower.includes("5h") ||
    lower.includes("5 hours")
  );
}

function providerKey(cfg: ResolvedConversationProviderConfig): string {
  return cfg.id ?? `${cfg.provider}:${cfg.model}:${cfg.kind}`;
}

async function readProviderCooldowns(): Promise<ProviderCooldownState> {
  const dir = join(process.cwd(), ".relayos", "overseer");
  const file = join(dir, PROVIDER_COOLDOWN_FILE);
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as ProviderCooldownState;
    if (!parsed || typeof parsed !== "object" || typeof parsed.providers !== "object") {
      return { providers: {} };
    }
    return parsed;
  } catch {
    return { providers: {} };
  }
}

async function writeProviderCooldowns(state: ProviderCooldownState): Promise<void> {
  const dir = join(process.cwd(), ".relayos", "overseer");
  await mkdir(dir, { recursive: true });
  const file = join(dir, PROVIDER_COOLDOWN_FILE);
  await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function setProviderCooldown(
  cfg: ResolvedConversationProviderConfig,
  durationMs: number,
  reason: string,
): Promise<void> {
  const key = providerKey(cfg);
  const state = await readProviderCooldowns();
  const until = new Date(Date.now() + durationMs).toISOString();
  state.providers[key] = {
    blocked_until: until,
    reason,
    updated_at: new Date().toISOString(),
  };
  await writeProviderCooldowns(state);
}

async function isProviderBlocked(cfg: ResolvedConversationProviderConfig): Promise<boolean> {
  const key = providerKey(cfg);
  const state = await readProviderCooldowns();
  const entry = state.providers[key];
  if (!entry) return false;
  const until = Date.parse(entry.blocked_until);
  if (!Number.isFinite(until)) return false;
  return until > Date.now();
}

export function resolveConversationProvider(
  config: RelayConfig,
  scope: ConversationScope,
): ConversationProvider | null {
  const providerConfig = resolveConversationProviderConfig(config);
  if (!providerConfig) return null;
  return new ConfiguredConversationProvider(providerConfig, scope);
}

/**
 * Append a conversation transcript to `<projectRoot>/.relayos/overseer/conversation_log.jsonl`.
 *
 * `projectRoot` is REQUIRED — callers must pass `scope.projectRoot`.
 * Previously this used `process.cwd()`, which silently wrote to
 * `bin/.relayos/overseer/conversation_log.jsonl` when the CLI ran from
 * the `bin/` directory and leaked private session content into git
 * (see plan §6.4 + Batch 1 gitignore fix).
 *
 * Exported for tests; production code paths reach it through
 * `handleConversation`.
 */
export async function appendConversationLog(
  messages: ConversationMessage[],
  projectRoot: string,
): Promise<void> {
  if (!projectRoot) {
    throw new Error("appendConversationLog: projectRoot is required");
  }
  const dir = join(projectRoot, ".relayos", "overseer");
  await mkdir(dir, { recursive: true });
  const logPath = join(dir, "conversation_log.jsonl");
  const now = new Date().toISOString();
  let payload = "";
  for (const msg of messages) {
    payload += `${JSON.stringify({ ts: now, role: msg.role, content: msg.content })}\n`;
  }
  if (payload.length > 0) {
    await appendFile(logPath, payload, "utf8");
  }
}

export async function handleConversation(
  messages: ConversationMessage[],
  config: RelayConfig,
  scope: ConversationScope,
): Promise<ConversationResult> {
  const configs = resolveConversationProviderConfigs(config);
  if (configs.length === 0) {
    await appendConversationLog(messages, scope.projectRoot);
    return {
      reply:
        "provider-not-configured: set overseer.provider, overseer.kind, and overseer.model in .relayos/config.json.",
      providerUsed: null,
      configured: false,
    };
  }
  let lastReply = "provider-execution-failed: no providers executed";
  let used = "configured";
  const active: ResolvedConversationProviderConfig[] = [];
  for (const cfg of configs) {
    if (!(await isProviderBlocked(cfg))) active.push(cfg);
  }
  const effective = active.length > 0 ? active : configs;
  for (let i = 0; i < effective.length; i++) {
    const cfg = effective[i]!;
    const provider = new ConfiguredConversationProvider(cfg, scope);
    const reply = await provider.chat(messages);
    used = `${cfg.provider}/${cfg.model}/${cfg.kind}`;
    if (isUsageLimitFailure(reply)) {
      await setProviderCooldown(cfg, 5 * 60 * 60 * 1000, "usage limit reached");
    }
    if (!isFallbackEligibleFailure(reply) || i === effective.length - 1) {
      lastReply = reply;
      break;
    }
    lastReply = `${reply}\n[fallback] switching to backup provider (${i + 2}/${effective.length})...`;
  }
  await appendConversationLog(
    [...messages, { role: "assistant", content: lastReply }],
    scope.projectRoot,
  );
  return {
    reply: lastReply,
    providerUsed: used,
    configured: true,
  };
}

// ── Overseer identity + context ────────────────────────────────────────────

/**
 * Load a text file from the overseer dir, capping at `maxChars` characters
 * (a soft byte bound). Returns null when the file is missing or unreadable.
 */
async function loadOverseerFile(overseerDir: string, name: string, maxChars: number): Promise<string | null> {
  try {
    const content = (await readFile(join(overseerDir, name), "utf8")).trim();
    if (content.length <= maxChars) return content;
    // Truncate by code point so a multi-unit character is never split mid-way.
    const codePoints = [...content];
    return codePoints.length > maxChars
      ? codePoints.slice(0, maxChars).join("") + "\n[…truncated]"
      : content;
  } catch {
    return null;
  }
}

/**
 * Load the last `n` JSONL records from a file, extract a text field.
 */
async function loadOverseerJsonlTail(
  overseerDir: string,
  name: string,
  n: number,
  extract: (parsed: Record<string, unknown>) => string | null,
): Promise<string[]> {
  try {
    const content = await readFile(join(overseerDir, name), "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    const tail = lines.slice(-n);
    return tail.flatMap((l) => {
      try {
        const p = JSON.parse(l) as Record<string, unknown>;
        const s = extract(p);
        return s ? [s] : [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

/**
 * Build the fixed 4-layer Overseer context bundle prepended to every
 * conversation turn:
 *   Layer 1 — identity (OVERSEER_ROLE_TEXT, a tracked product constant)
 *   Layer 2 — policy   (OPERATING_POLICY / FORBIDDEN_ACTIONS / MODEL_POLICY)
 *   Layer 3 — project  (PROJECT_BRIEF / CURRENT_STATE / TODO / NEXT_ACTION)
 *   Layer 4 — recent truth (recent decisions / timeline / handoff results)
 * Layers 2-4 read the project's `.relayos/overseer/` directory; missing files
 * are omitted gracefully. Returns a plain text block ready to embed.
 */
async function buildOverseerContextBundle(projectRoot: string): Promise<string> {
  const overseerDir = join(projectRoot, ".relayos", "overseer");

  // Layer 2 — policy (each capped at ~4 KB)
  const [policy, forbidden, modelPolicy] = await Promise.all([
    loadOverseerFile(overseerDir, "OPERATING_POLICY.md", 4096),
    loadOverseerFile(overseerDir, "FORBIDDEN_ACTIONS.md", 4096),
    loadOverseerFile(overseerDir, "MODEL_POLICY.md", 4096),
  ]);

  // Layer 3 — project (each capped at ~8 KB)
  const [brief, state, todo, nextAction] = await Promise.all([
    loadOverseerFile(overseerDir, "PROJECT_BRIEF.md", 8192),
    loadOverseerFile(overseerDir, "CURRENT_STATE.md", 8192),
    loadOverseerFile(overseerDir, "TODO.md", 8192),
    loadOverseerFile(overseerDir, "NEXT_ACTION.md", 8192),
  ]);

  // Layer 4 — recent truth
  const [decisions, timeline, results] = await Promise.all([
    loadOverseerJsonlTail(overseerDir, "decisions.jsonl", 5,
      (p) => typeof p["text"] === "string" ? `  - ${p["text"].slice(0, 200)}` : null),
    loadOverseerJsonlTail(overseerDir, "timeline.jsonl", 8,
      (p) => {
        const ts = typeof p["ts"] === "string" ? p["ts"].slice(0, 10) : "?";
        return typeof p["text"] === "string" ? `  [${ts}] ${p["text"].slice(0, 200)}` : null;
      }),
    loadOverseerJsonlTail(overseerDir, "handoff_results.jsonl", 3,
      (p) => typeof p["summary"] === "string"
        ? `  [${p["status"] ?? "?"}] ${p["summary"].slice(0, 150)}`
        : null),
  ]);

  // Assemble — Layer 1 (identity) first, then Layers 2/3/4 in order.
  const parts: string[] = [OVERSEER_ROLE_TEXT];

  // Layer 2
  if (policy) parts.push("", "=== OPERATING POLICY ===", policy);
  if (forbidden) parts.push("", "=== FORBIDDEN ACTIONS ===", forbidden);
  if (modelPolicy) parts.push("", "=== MODEL POLICY ===", modelPolicy);

  // Layer 3
  if (brief) parts.push("", "=== PROJECT BRIEF ===", brief);
  if (state) parts.push("", "=== CURRENT STATE ===", state);
  if (todo) parts.push("", "=== TODO ===", todo);
  if (nextAction) parts.push("", "=== NEXT ACTION ===", nextAction);

  // Layer 4
  if (decisions.length > 0) parts.push("", "=== RECENT DECISIONS ===", decisions.join("\n"));
  if (timeline.length > 0) parts.push("", "=== RECENT TIMELINE ===", timeline.join("\n"));
  if (results.length > 0) parts.push("", "=== RECENT HANDOFF RESULTS ===", results.join("\n"));

  return parts.join("\n");
}

async function buildScopedProviderInput(projectRoot: string, userMessage: string): Promise<string> {
  const identity = await buildOverseerContextBundle(projectRoot);
  return [
    identity,
    "",
    "=== OPERATING INSTRUCTIONS ===",
    `- Allowed context is only the current project/worktree root: ${projectRoot}`,
    "- Do not read, cite, summarize, or rely on files outside this project/worktree.",
    "- Do not read ~/.agent-access.md or any home-directory files unless the user explicitly approves it.",
    "- If outside-project context is needed, ask for approval before reading it.",
    "- Do not edit files.",
    "- Do not run shell commands.",
    "- Do not claim any tests/builds/commands were executed.",
    "- Always return a normal human-facing answer.",
    "- If the user appears to be asking for project work, you may append one optional ACTION_INTENT block at the end.",
    "- PROVIDER ROUTING GUIDANCE — choose `target` by task fit:",
    "  - codex: implementation, applying patches, refactors, writing and running tests.",
    "  - claude: review, planning, code analysis, explanation, documentation.",
    "  - overseer: keep local — discussion, clarification, no agent dispatch.",
    "  Set `mode` to match: patch/test for codex implementation work, review/plan for claude analysis work.",
    "- For a NEW PROJECT or a sizable NEW FEATURE (multi-step work), use",
    "  intent_type: project_plan — the overseer will dispatch a planning job that",
    "  breaks the work into a todo list. Use create_handoff only for a single",
    "  well-scoped change.",
    "- ACTION_INTENT format:",
    "ACTION_INTENT",
    "intent_type: conversation | create_task | create_handoff | review | release_control | project_plan",
    "confidence: 0.0-1.0",
    "summary: one-line description of the proposed action",
    "target: codex | claude | overseer",
    "model: <model id>",
    "effort: low | medium | high | xhigh | max",
    "mode: patch | plan | review | test",
    "approval_required: true | false",
    "suggested_next_command: /task ... | /handoff ... | /review ...",
    "END_ACTION_INTENT",
    "",
    "USER MESSAGE:",
    userMessage,
  ].join("\n");
}
