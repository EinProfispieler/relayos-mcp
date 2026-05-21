import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface, type Interface } from "node:readline";
import type { RelayConfig } from "./schema.js";
import { RelayConfig as RelayConfigSchema } from "./schema.js";
import { loadProjectConfig } from "./config.js";
import { encryptConfigSecret } from "./secret_crypto.js";
import { ensureProjectConfigSecret } from "./config_secret.js";
import { buildOverseerFromPool } from "./overseer_config.js";

const CONFIG_DIR = ".relayos";
const CONFIG_FILE = "config.json";
const CANCEL_TOKENS = new Set(["/cancel", "cancel"]);

const KIND_OPTIONS = ["subscription", "api", "fallback", "subscription_cli", "local_command"] as const;
const EXECUTION_MODE_OPTIONS = ["subscription_cli", "local_command"] as const;
const LANGUAGE_OPTIONS = ["english", "chinese"] as const;
const FLOW_OPTIONS = ["quick", "advanced", "preset", "pool", "show", "cancel"] as const;
const PRESET_OPTIONS = [
  "codex-plan",
  "claude-plan",
  "codex-api",
  "claude-api",
  "glm-api",
  "custom",
  "cancel",
] as const;
const GLM_PLAN_MODELS = ["GLM-5.1", "GLM-5-Turbo", "GLM-4.7", "GLM-4.5-Air"] as const;
const GLM_CODING_API_BASE_CN = "https://open.bigmodel.cn/api/coding/paas/v4";
const GLM_CODING_API_BASE_GLOBAL = "https://api.z.ai/api/coding/paas/v4";

export interface SettingsValues {
  provider: string;
  kind: "subscription" | "api" | "fallback" | "subscription_cli" | "local_command";
  model: string;
  effort: string;
  language: "english" | "chinese";
  execution_mode: "local_command" | "subscription_cli";
  command: string;
  args: string[];
  timeout_ms: number;
  api_base: string;
  api_key: string;
  api_key_env: string;
  api_format: "openai_compatible" | "anthropic_messages";
  codex_model: string;
  codex_effort: "low" | "medium" | "high";
  claude_model: string;
  claude_effort: "low" | "medium" | "high";
}

interface ProviderPoolEntry {
  id: string;
  name: string;
  kind: "subscription" | "api" | "fallback" | "subscription_cli" | "local_command";
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
}

interface PromptIO {
  write: (text: string) => unknown;
  ask: (prompt: string) => Promise<string>;
}

function isClaudeProvider(provider: string): boolean {
  const p = provider.trim().toLowerCase();
  return p.includes("claude") || p.includes("anthropic");
}

function defaultCommandForProvider(provider: string): string {
  return isClaudeProvider(provider) ? "claude" : "codex";
}

function defaultArgsForProvider(provider: string): string[] {
  if (isClaudeProvider(provider)) {
    return [
      "-p",
      "{{input}}",
      "--model",
      "{{model}}",
    ];
  }
  return [
    "exec",
    "--model",
    "{{model}}",
    "-c",
    "model_reasoning_effort={{effort}}",
    "--sandbox",
    "read-only",
    "{{input}}",
  ];
}

function resolveWritePath(cwd: string): string {
  const loaded = loadProjectConfig({ cwd });
  if (loaded.source) return loaded.source;
  return join(resolve(cwd), CONFIG_DIR, CONFIG_FILE);
}

function readExistingConfig(path: string): RelayConfig {
  if (!existsSync(path)) return RelayConfigSchema.parse({});
  const raw = readFileSync(path, "utf8");
  return RelayConfigSchema.parse(JSON.parse(raw));
}

function splitArgs(raw: string): string[] {
  const input = raw.trim();
  if (input.length === 0) return [];
  if (input.startsWith("[")) {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
        return parsed;
      }
    } catch {
      // fall through
    }
  }

  const out: string[] = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  for (const match of input.matchAll(re)) {
    const token = match[1] ?? match[2] ?? match[3] ?? "";
    out.push(token.replace(/\\(["'\\])/g, "$1"));
  }
  return out;
}

function normalizeDefaults(cwd: string): SettingsValues {
  const loaded = loadProjectConfig({ cwd });
  const current = loaded.config.overseer;
  const providerObject =
    current?.provider && typeof current.provider === "object" ? current.provider : null;

  const provider = providerObject?.name ?? current?.provider;
  const kind = providerObject?.kind ?? current?.kind;
  const model = providerObject?.model ?? current?.model;
  const effort = providerObject?.effort ?? current?.effort;
  const language = providerObject?.language ?? current?.language;
  const executionMode = providerObject?.execution_mode ?? current?.execution_mode;
  const command = providerObject?.command ?? current?.command;
  const args = providerObject?.args ?? current?.args;
  const timeout = providerObject?.timeout_ms ?? current?.timeout_ms;
  const apiBase = providerObject?.api_base ?? current?.api_base;
  const apiKey = providerObject?.api_key ?? current?.api_key;
  const apiKeyEnv = providerObject?.api_key_env ?? current?.api_key_env;
  const apiFormat = providerObject?.api_format ?? current?.api_format;
  const codexModel = current?.codex_model;
  const codexEffort = current?.codex_effort;
  const claudeModel = current?.claude_model;
  const claudeEffort = current?.claude_effort;

  return {
    provider: typeof provider === "string" ? provider : "codex",
    kind: KIND_OPTIONS.includes(kind as SettingsValues["kind"]) ? (kind as SettingsValues["kind"]) : "subscription_cli",
    model:
      typeof model === "string" && model.trim().length > 0
        ? normalizeModelToken(model)
        : "gpt-5.3-codex",
    effort: typeof effort === "string" && effort.trim().length > 0 ? effort : "medium",
    language: language === "chinese" ? "chinese" : "english",
    execution_mode:
      EXECUTION_MODE_OPTIONS.includes(executionMode as SettingsValues["execution_mode"])
        ? (executionMode as SettingsValues["execution_mode"])
        : "subscription_cli",
    command:
      typeof command === "string" && command.trim().length > 0
        ? command
        : defaultCommandForProvider(typeof provider === "string" ? provider : "codex"),
    args:
      Array.isArray(args) && args.length > 0
        ? args
        : defaultArgsForProvider(typeof provider === "string" ? provider : "codex"),
    timeout_ms: typeof timeout === "number" && Number.isInteger(timeout) && timeout > 0 ? timeout : 120000,
    api_base: typeof apiBase === "string" && apiBase.trim().length > 0 ? apiBase.trim() : "",
    api_key: typeof apiKey === "string" ? apiKey : "",
    api_key_env: typeof apiKeyEnv === "string" && apiKeyEnv.trim().length > 0 ? apiKeyEnv.trim() : "",
    api_format:
      apiFormat === "anthropic_messages" || apiFormat === "openai_compatible"
        ? apiFormat
        : "openai_compatible",
    codex_model:
      typeof codexModel === "string" && codexModel.trim().length > 0
        ? normalizeModelToken(codexModel)
        : "gpt-5.5",
    codex_effort:
      codexEffort === "low" || codexEffort === "medium" || codexEffort === "high"
        ? codexEffort
        : "high",
    claude_model:
      typeof claudeModel === "string" && claudeModel.trim().length > 0
        ? normalizeModelToken(claudeModel)
        : "claude-sonnet-4-6",
    claude_effort:
      claudeEffort === "low" || claudeEffort === "medium" || claudeEffort === "high"
        ? claudeEffort
        : "medium",
  };
}

function codexPreset(model: string, timeoutMs: number): SettingsValues {
  return {
    provider: "codex",
    kind: "subscription_cli",
    model,
    effort: "medium",
    language: "english",
    execution_mode: "subscription_cli",
    command: "codex",
    args: [
      "exec",
      "--model",
      "{{model}}",
      "-c",
      "model_reasoning_effort={{effort}}",
      "--sandbox",
      "read-only",
      "{{input}}",
    ],
    timeout_ms: timeoutMs,
    api_base: "",
    api_key: "",
    api_key_env: "",
    api_format: "openai_compatible",
    codex_model: "gpt-5.5",
    codex_effort: "high",
    claude_model: "claude-sonnet-4-6",
    claude_effort: "medium",
  };
}

function claudePlanPreset(model: string, timeoutMs: number): SettingsValues {
  return {
    provider: "claude",
    kind: "subscription",
    model,
    effort: "medium",
    language: "english",
    execution_mode: "subscription_cli",
    command: "claude",
    args: ["-p", "{{input}}", "--model", "{{model}}"],
    timeout_ms: timeoutMs,
    api_base: "",
    api_key: "",
    api_key_env: "",
    api_format: "anthropic_messages",
    codex_model: "gpt-5.5",
    codex_effort: "high",
    claude_model: "claude-sonnet-4-6",
    claude_effort: "medium",
  };
}

function apiPreset(
  provider: string,
  model: string,
  apiBase: string,
  apiKeyEnv: string,
  apiFormat: "openai_compatible" | "anthropic_messages",
  timeoutMs: number,
): SettingsValues {
  return {
    provider,
    kind: "api",
    model,
    effort: "medium",
    language: "english",
    execution_mode: "local_command",
    command: "codex",
    args: [
      "exec",
      "--model",
      "{{model}}",
      "-c",
      "model_reasoning_effort={{effort}}",
      "--sandbox",
      "read-only",
      "{{input}}",
    ],
    timeout_ms: timeoutMs,
    api_base: apiBase,
    api_key: "",
    api_key_env: apiKeyEnv,
    api_format: apiFormat,
    codex_model: "gpt-5.5",
    codex_effort: "high",
    claude_model: "claude-sonnet-4-6",
    claude_effort: "medium",
  };
}

function isCanceled(value: string): boolean {
  return CANCEL_TOKENS.has(value.trim().toLowerCase());
}

function withFallback(input: string, fallback: string): string {
  const value = input.trim();
  return value.length > 0 ? value : fallback;
}

function normalizeModelToken(raw: string): string {
  const input = raw.trim();
  const lower = input.toLowerCase().replace(/\s+/g, "");
  if (lower === "gpt5.5" || lower === "gpt-55" || lower === "gpt55") return "gpt-5.5";
  if (lower === "gpt5.4" || lower === "gpt-54" || lower === "gpt54") return "gpt-5.4";
  if (lower === "gpt5.3-codex" || lower === "gpt53-codex" || lower === "gpt-53-codex") {
    return "gpt-5.3-codex";
  }
  return input;
}

function printGlmModelHint(io: PromptIO): void {
  io.write(`GLM plan models: ${GLM_PLAN_MODELS.join(", ")}\n`);
}

function printHeader(io: PromptIO, defaults: SettingsValues): void {
  io.write("RelayOS provider settings (CLI mode or API token mode)\n");
  io.write("Press Enter to keep current value.\n");
  io.write("Type /cancel or cancel at any prompt to abort without saving.\n\n");
  io.write("Current effective settings:\n");
  io.write(`  provider: ${defaults.provider}\n`);
  io.write(`  kind: ${defaults.kind}\n`);
  io.write(`  model: ${defaults.model}\n`);
  io.write(`  effort: ${defaults.effort}\n`);
  io.write(`  language: ${defaults.language}\n`);
  io.write(`  execution_mode: ${defaults.execution_mode}\n`);
  io.write(`  command: ${defaults.command}\n`);
  io.write(`  args: ${defaults.args.join(" ")}\n`);
  io.write(`  timeout_ms: ${defaults.timeout_ms}\n`);
  io.write(`  api_base: ${defaults.api_base || "(auto by provider)"}\n`);
  io.write(`  api_key: ${defaults.api_key ? "***set***" : "(empty)"}\n`);
  io.write(`  api_key_env: ${defaults.api_key_env || "(empty)"}\n`);
  io.write(`  api_format: ${defaults.api_format}\n`);
  io.write(`  codex_model: ${defaults.codex_model}\n`);
  io.write(`  codex_effort: ${defaults.codex_effort}\n`);
  io.write(`  claude_model: ${defaults.claude_model}\n`);
  io.write(`  claude_effort: ${defaults.claude_effort}\n\n`);
}

async function askValue(
  io: PromptIO,
  prompt: string,
  fallback: string,
  validate: (value: string) => string | null,
): Promise<string | null> {
  while (true) {
    const raw = await io.ask(prompt);
    if (isCanceled(raw)) return null;
    const value = withFallback(raw, fallback);
    const err = validate(value);
    if (!err) return value;
    io.write(`${err}\n`);
  }
}

async function askChoice<T extends string>(
  io: PromptIO,
  prompt: string,
  fallback: T,
  options: readonly T[],
  invalidMessage: string,
): Promise<T | null> {
  const value = await askValue(io, prompt, fallback, (v) =>
    options.includes(v as T) ? null : invalidMessage,
  );
  return value as T | null;
}

function looksLikeApiKey(input: string): boolean {
  const s = input.trim();
  if (s.length < 20) return false;
  return /[A-Za-z0-9._-]{20,}/.test(s);
}

async function askPositiveInt(io: PromptIO, prompt: string, fallback: number): Promise<number | null> {
  const raw = await askValue(io, prompt, String(fallback), (v) => {
    const parsed = Number.parseInt(v, 10);
    if (!/^\d+$/.test(v) || !Number.isInteger(parsed) || parsed <= 0) {
      return "timeout_ms must be a positive integer";
    }
    return null;
  });
  return raw === null ? null : Number.parseInt(raw, 10);
}

function saveAndReport(cwd: string, io: PromptIO, values: SettingsValues): void {
  const path = persistConversationSettings(cwd, values);
  io.write(`Saved settings to ${path}\n`);
  io.write(
    `Provider route: ${values.provider}/${values.model}/${values.kind} via ${values.execution_mode}\n`,
  );
}

function persistProviderPoolSettings(
  cwd: string,
  providers: ProviderPoolEntry[],
  primaryId: string,
  backupIds: string[],
): string {
  const cfgPath = resolveWritePath(cwd);
  const prev = readExistingConfig(cfgPath);
  const nextOverseer = buildOverseerFromPool(prev.overseer, providers, primaryId, backupIds);
  const next = RelayConfigSchema.parse({
    ...prev,
    overseer: {
      ...nextOverseer,
    },
  });
  mkdirSync(dirname(cfgPath), { recursive: true });
  writeFileSync(cfgPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return cfgPath;
}

async function runPoolFlow(cwd: string, io: PromptIO, defaults: SettingsValues): Promise<void> {
  const countRaw = await askValue(io, "provider count [2] (1-4): ", "2", (v) => {
    const n = Number.parseInt(v, 10);
    return Number.isInteger(n) && n >= 1 && n <= 4 ? null : "count must be 1..4";
  });
  if (countRaw === null) {
    io.write("Settings update canceled. Nothing was saved.\n");
    return;
  }
  const count = Number.parseInt(countRaw, 10);
  const providers: ProviderPoolEntry[] = [];
  let secret = process.env.RELAYOS_CONFIG_SECRET?.trim();

  for (let i = 1; i <= count; i++) {
    io.write(`\nProvider #${i}\n`);
    const name = await askChoice(
      io,
      `name [codex/claude/glm/custom] [codex]: `,
      "codex",
      ["codex", "claude", "glm", "custom"] as const,
      "invalid provider",
    );
    if (name === null) {
      io.write("Settings update canceled. Nothing was saved.\n");
      return;
    }
    const providerName = name === "custom"
      ? (await askValue(io, "custom provider name: ", "", (v) => (v.trim().length > 0 ? null : "required")))
      : name;
    if (!providerName) {
      io.write("Settings update canceled. Nothing was saved.\n");
      return;
    }
    let kind: "subscription_cli" | "api" | null = null;
    while (kind === null) {
      const raw = await io.ask(`kind [subscription_cli/api] [subscription_cli]: `);
      if (isCanceled(raw)) {
        io.write("Settings update canceled. Nothing was saved.\n");
        return;
      }
      const value = withFallback(raw, "subscription_cli").trim();
      if (value === "subscription_cli" || value === "api") {
        kind = value;
        break;
      }
      if (looksLikeApiKey(value)) {
        io.write(
          "It looks like you pasted an API key. Choose kind 'api' first; the key prompt comes next.\n",
        );
      } else {
        io.write("invalid kind\n");
      }
    }
    const effort =
      providerName === "glm"
        ? "medium"
        : await askChoice(
          io,
          `effort [${defaults.effort}] (low/medium/high): `,
          (defaults.effort === "low" || defaults.effort === "high" ? defaults.effort : "medium") as "low" | "medium" | "high",
          ["low", "medium", "high"] as const,
          "invalid effort",
        );
    if (effort === null) {
      io.write("Settings update canceled. Nothing was saved.\n");
      return;
    }
    if (providerName === "glm") {
      io.write("GLM API does not use effort; fixed to medium.\n");
    }
    const modelDefault =
      providerName === "claude" ? defaults.claude_model : providerName === "glm" ? "GLM-5.1" : defaults.codex_model;
    if (providerName === "glm") {
      printGlmModelHint(io);
    }
    const model = await askValue(io, `model [${modelDefault}]: `, modelDefault, (v) =>
      v.trim().length > 0 ? null : "model required",
    );
    if (model === null) {
      io.write("Settings update canceled. Nothing was saved.\n");
      return;
    }
    if (kind === "api") {
      if (!["codex", "claude", "glm"].includes(providerName)) {
        io.write(
          "\n[Danger] Official API mode supports only Codex/OpenAI, Claude/Anthropic, and GLM/Zhipu.\n",
        );
        const c = await askValue(io, "Type I UNDERSTAND to continue custom API setup (or /cancel): ", "", () => null);
        if (c === null || c.trim() !== "I UNDERSTAND") {
          io.write("Custom API setup canceled. Nothing was saved.\n");
          return;
        }
      }
      const apiBaseDefault =
        providerName === "claude"
          ? "https://api.anthropic.com/v1"
          : providerName === "glm"
          ? GLM_CODING_API_BASE_CN
          : "https://api.openai.com/v1";
      if (providerName === "glm") {
        io.write(`GLM China endpoint: ${GLM_CODING_API_BASE_CN}\n`);
        io.write("GLM China metered endpoint: https://open.bigmodel.cn/api/paas/v4\n");
        io.write(`GLM Global(z.ai) endpoint: ${GLM_CODING_API_BASE_GLOBAL}\n`);
      }
      const apiBase = await askValue(io, `api_base [${apiBaseDefault}]: `, apiBaseDefault, () => null);
      if (apiBase === null) {
        io.write("Settings update canceled. Nothing was saved.\n");
        return;
      }
      const apiFormatDefault = providerName === "claude" ? "anthropic_messages" : "openai_compatible";
      const apiFormat = await askChoice(
        io,
        `api_format [${apiFormatDefault}] (openai_compatible/anthropic_messages): `,
        apiFormatDefault as "openai_compatible" | "anthropic_messages",
        ["openai_compatible", "anthropic_messages"] as const,
        "invalid api_format",
      );
      if (apiFormat === null) {
        io.write("Settings update canceled. Nothing was saved.\n");
        return;
      }
      const apiKeyEnv = await askValue(
        io,
        "api_key_env [empty] (env var name only, e.g. ZHIPU_API_KEY): ",
        "",
        () => null,
      );
      if (apiKeyEnv === null) {
        io.write("Settings update canceled. Nothing was saved.\n");
        return;
      }
      let apiKeyEnvValue = apiKeyEnv.trim();
      if (looksLikeApiKey(apiKeyEnvValue)) {
        io.write("Detected a token in api_key_env. This field should be an environment variable name.\n");
        io.write("Use api_key below for direct key input, or enter an env var name.\n");
        apiKeyEnvValue = "";
      }
      io.write("Auth: choose ONE method -> api_key_env (recommended) OR api_key (direct).\n");
      const apiKey = await askValue(io, "api_key [empty] (direct raw token): ", "", () => null);
      if (apiKey === null) {
        io.write("Settings update canceled. Nothing was saved.\n");
        return;
      }
      let api_key_enc: string | undefined;
      if (apiKey.trim().length > 0) {
        if (!secret) secret = ensureProjectConfigSecret(cwd);
        api_key_enc = encryptConfigSecret(apiKey.trim(), secret);
      }
      providers.push({
        id: `p${i}`,
        name: providerName,
        kind: "api",
        model: normalizeModelToken(model),
        effort,
        timeout_ms: defaults.timeout_ms,
        api_base: apiBase.trim(),
        api_key_env: apiKeyEnvValue || undefined,
        api_key_enc,
        api_format: apiFormat,
      });
      continue;
    }

    providers.push({
      id: `p${i}`,
      name: providerName,
      kind: "subscription_cli",
      model: normalizeModelToken(model),
      effort,
      execution_mode: "subscription_cli",
      command: defaultCommandForProvider(providerName),
      args: defaultArgsForProvider(providerName),
      timeout_ms: defaults.timeout_ms,
    });
  }

  io.write("\nConfigured providers:\n");
  providers.forEach((p, idx) => io.write(`  ${idx + 1}. ${p.name}/${p.model}/${p.kind}\n`));
  const orderDefault = providers.map((_, idx) => String(idx + 1)).join(",");
  const orderRaw = await askValue(
    io,
    `order [${orderDefault}] (example: 2,1,3): `,
    orderDefault,
    (v) => {
      const parts = v.split(",").map((x) => x.trim()).filter(Boolean);
      if (parts.length !== providers.length) return "order must include all providers exactly once";
      const nums = parts.map((p) => Number.parseInt(p, 10));
      if (nums.some((n) => !Number.isInteger(n) || n < 1 || n > providers.length)) return "invalid index";
      if (new Set(nums).size !== providers.length) return "duplicate index";
      return null;
    },
  );
  if (orderRaw === null) {
    io.write("Settings update canceled. Nothing was saved.\n");
    return;
  }
  const order = orderRaw.split(",").map((x) => Number.parseInt(x.trim(), 10));
  const sorted = order.map((n) => providers[n - 1]!);
  const primary = sorted[0]!;
  const backups = sorted.slice(1).map((p) => p.id);
  const path = persistProviderPoolSettings(cwd, sorted, primary.id, backups);
  io.write(`Saved provider pool to ${path}\n`);
  io.write(`Primary: ${primary.name}/${primary.model}\n`);
  if (backups.length > 0) io.write(`Backups: ${sorted.slice(1).map((p) => `${p.name}/${p.model}`).join(", ")}\n`);
}

async function runPresetFlow(cwd: string, io: PromptIO, defaults: SettingsValues): Promise<boolean> {
  const preset = await askChoice(
    io,
    "preset [codex-plan/claude-plan/codex-api/claude-api/glm-api/custom/cancel] [custom]: ",
    "custom",
    PRESET_OPTIONS,
    "invalid preset",
  );
  if (preset === null || preset === "cancel") {
    io.write("Settings update canceled. Nothing was saved.\n");
    return false;
  }
  if (preset === "custom") {
    io.write("\n[Danger] Custom provider mode can execute unknown commands or send data to unknown endpoints.\n");
    io.write("[Danger] Only continue if you fully trust the provider, command, and arguments.\n");
    const confirm = await askValue(
      io,
      "Type I UNDERSTAND to continue custom setup (or /cancel): ",
      "",
      () => null,
    );
    if (confirm === null || confirm.trim() !== "I UNDERSTAND") {
      io.write("Custom setup canceled. Nothing was saved.\n");
      return false;
    }
    return true;
  }
  const values =
    preset === "codex-plan"
      ? codexPreset("gpt-5.5", defaults.timeout_ms)
      : preset === "claude-plan"
      ? claudePlanPreset("claude-sonnet-4-6", defaults.timeout_ms)
      : preset === "codex-api"
      ? apiPreset("codex", "gpt-5.5", "https://api.openai.com/v1", "OPENAI_API_KEY", "openai_compatible", defaults.timeout_ms)
      : preset === "claude-api"
      ? apiPreset("claude", "claude-sonnet-4-6", "https://api.anthropic.com/v1", "ANTHROPIC_API_KEY", "anthropic_messages", defaults.timeout_ms)
      : apiPreset("glm", "GLM-5.1", GLM_CODING_API_BASE_CN, "ZHIPU_API_KEY", "openai_compatible", defaults.timeout_ms);
  saveAndReport(cwd, io, values);
  return false;
}

async function runQuickFlow(cwd: string, io: PromptIO, defaults: SettingsValues): Promise<void> {
  io.write("\nQuick setup (recommended)\n");
  const ai = await askChoice(
    io,
    "AI [codex/claude/glm] [codex]: ",
    "codex",
    ["codex", "claude", "glm"] as const,
    "invalid AI",
  );
  if (ai === null) {
    io.write("Settings update canceled. Nothing was saved.\n");
    return;
  }

  const modeOptions = ai === "glm" ? (["api"] as const) : (["plan", "api"] as const);
  const mode = await askChoice(
    io,
    `Mode [${modeOptions.join("/")}] [${modeOptions[0]}]: `,
    modeOptions[0],
    modeOptions,
    "invalid mode",
  );
  if (mode === null) {
    io.write("Settings update canceled. Nothing was saved.\n");
    return;
  }

  const timeoutMs = await askPositiveInt(io, `timeout_ms [${defaults.timeout_ms}]: `, defaults.timeout_ms);
  if (timeoutMs === null) {
    io.write("Settings update canceled. Nothing was saved.\n");
    return;
  }

  let values: SettingsValues;
  if (mode === "plan") {
    values =
      ai === "claude"
        ? claudePlanPreset(defaults.claude_model, timeoutMs)
        : codexPreset(defaults.codex_model, timeoutMs);
  } else {
    values =
      ai === "claude"
        ? apiPreset("claude", defaults.claude_model, "https://api.anthropic.com/v1", "ANTHROPIC_API_KEY", "anthropic_messages", timeoutMs)
        : ai === "glm"
        ? apiPreset("glm", "GLM-5.1", GLM_CODING_API_BASE_CN, "ZHIPU_API_KEY", "openai_compatible", timeoutMs)
        : apiPreset("codex", defaults.codex_model, "https://api.openai.com/v1", "OPENAI_API_KEY", "openai_compatible", timeoutMs);
    if (ai === "glm") {
      printGlmModelHint(io);
      io.write(`GLM China endpoint: ${GLM_CODING_API_BASE_CN}\n`);
      io.write(`GLM Global(z.ai) endpoint: ${GLM_CODING_API_BASE_GLOBAL}\n`);
    }

    const envName = await askValue(
      io,
      `API key env [${values.api_key_env || "NONE"}]: `,
      values.api_key_env,
      () => null,
    );
    if (envName === null) {
      io.write("Settings update canceled. Nothing was saved.\n");
      return;
    }
    values.api_key_env = envName.trim();
    if (values.api_key_env.length === 0) {
      io.write("Warning: API mode selected but api_key_env is empty.\n");
    }
  }

  const language = await askChoice(
    io,
    `language [${defaults.language}] (english/chinese): `,
    defaults.language,
    LANGUAGE_OPTIONS,
    "invalid language",
  );
  if (language === null) {
    io.write("Settings update canceled. Nothing was saved.\n");
    return;
  }
  values.language = language;
  saveAndReport(cwd, io, values);
}

async function runAdvancedFlow(cwd: string, io: PromptIO, defaults: SettingsValues): Promise<void> {
  const provider = await askValue(io, `provider [${defaults.provider}]: `, defaults.provider, (v) =>
    v.trim().length > 0 ? null : "provider must be non-empty",
  );
  if (provider === null) {
    io.write("Settings update canceled. Nothing was saved.\n");
    return;
  }
  const providerDefaultCommand = defaultCommandForProvider(provider);
  const providerDefaultArgs = defaultArgsForProvider(provider);

  const kind = await askChoice(
    io,
    `kind [${defaults.kind}] (subscription/api/fallback/subscription_cli/local_command): `,
    defaults.kind,
    KIND_OPTIONS,
    "invalid kind",
  );
  if (kind === null) {
    io.write("Settings update canceled. Nothing was saved.\n");
    return;
  }

  const model = await askValue(io, `model [${defaults.model}]: `, defaults.model, (v) =>
    v.trim().length > 0 ? null : "model must be non-empty",
  );
  if (model === null) {
    io.write("Settings update canceled. Nothing was saved.\n");
    return;
  }

  const effort = await askValue(io, `effort [${defaults.effort}]: `, defaults.effort, () => null);
  if (effort === null) {
    io.write("Settings update canceled. Nothing was saved.\n");
    return;
  }

  const language = await askChoice(
    io,
    `language [${defaults.language}] (english/chinese): `,
    defaults.language,
    LANGUAGE_OPTIONS,
    "invalid language",
  );
  if (language === null) {
    io.write("Settings update canceled. Nothing was saved.\n");
    return;
  }

  const executionMode = await askChoice(
    io,
    `execution_mode [${defaults.execution_mode}] (subscription_cli/local_command): `,
    defaults.execution_mode,
    EXECUTION_MODE_OPTIONS,
    "invalid execution_mode",
  );
  if (executionMode === null) {
    io.write("Settings update canceled. Nothing was saved.\n");
    return;
  }

  let command = defaults.command || providerDefaultCommand;
  let args = defaults.args.length > 0 ? defaults.args : providerDefaultArgs;
  let apiBase = defaults.api_base;
  let apiKey = defaults.api_key;
  let apiKeyEnv = defaults.api_key_env;
  let apiFormat = defaults.api_format;

  if (kind === "api") {
    const normalizedProvider = provider.trim().toLowerCase();
    const isOfficialApiProvider =
      normalizedProvider === "codex" ||
      normalizedProvider === "openai" ||
      normalizedProvider === "claude" ||
      normalizedProvider === "anthropic" ||
      normalizedProvider === "glm" ||
      normalizedProvider === "zhipu";
    if (!isOfficialApiProvider) {
      io.write(
        "\n[Danger] Official API mode supports only Codex/OpenAI, Claude/Anthropic, and GLM/Zhipu.\n",
      );
      io.write(
        "[Danger] You selected a custom API provider. Verify endpoint, auth, and data policy before continuing.\n",
      );
      const confirmCustomApi = await askValue(
        io,
        "Type I UNDERSTAND to continue custom API setup (or /cancel): ",
        "",
        () => null,
      );
      if (confirmCustomApi === null || confirmCustomApi.trim() !== "I UNDERSTAND") {
        io.write("Custom API setup canceled. Nothing was saved.\n");
        return;
      }
    }

    const apiBaseInput = await askValue(
      io,
      `api_base [${defaults.api_base || "(auto)"}]: `,
      defaults.api_base,
      () => null,
    );
    if (apiBaseInput === null) {
      io.write("Settings update canceled. Nothing was saved.\n");
      return;
    }
    apiBase = apiBaseInput.trim();
    const apiFormatInput = await askChoice(
      io,
      `api_format [${defaults.api_format}] (openai_compatible/anthropic_messages): `,
      defaults.api_format,
      ["openai_compatible", "anthropic_messages"] as const,
      "invalid api_format",
    );
    if (apiFormatInput === null) {
      io.write("Settings update canceled. Nothing was saved.\n");
      return;
    }
    apiFormat = apiFormatInput;
    const apiKeyEnvInput = await askValue(
      io,
      `api_key_env [${defaults.api_key_env || "NONE"}]: `,
      defaults.api_key_env,
      () => null,
    );
    if (apiKeyEnvInput === null) {
      io.write("Settings update canceled. Nothing was saved.\n");
      return;
    }
    apiKeyEnv = apiKeyEnvInput.trim();
    const apiKeyInput = await askValue(
      io,
      `api_key [${defaults.api_key ? "***set***" : "empty"}]: `,
      defaults.api_key,
      () => null,
    );
    if (apiKeyInput === null) {
      io.write("Settings update canceled. Nothing was saved.\n");
      return;
    }
    apiKey = apiKeyInput.trim();
  } else {
    const commandInput = await askValue(io, `command [${command}]: `, command, (v) =>
      v.trim().length > 0 ? null : "command must be non-empty for local_command/subscription_cli",
    );
    if (commandInput === null) {
      io.write("Settings update canceled. Nothing was saved.\n");
      return;
    }
    command = commandInput;

    const argsRaw = await io.ask(`args (JSON array or shell-like string) [${args.join(" ")}]: `);
    if (isCanceled(argsRaw)) {
      io.write("Settings update canceled. Nothing was saved.\n");
      return;
    }
    args = splitArgs(withFallback(argsRaw, args.join(" ")));
    if (args.length === 0) {
      io.write("args cannot be empty\n");
      return;
    }
    if (!args.includes("{{input}}")) {
      io.write("args must include {{input}} placeholder\n");
      return;
    }
  }

  const timeoutMs = await askPositiveInt(io, `timeout_ms [${defaults.timeout_ms}]: `, defaults.timeout_ms);
  if (timeoutMs === null) {
    io.write("Settings update canceled. Nothing was saved.\n");
    return;
  }
  const codexModel = await askValue(
    io,
    `codex_model [${defaults.codex_model}]: `,
    defaults.codex_model,
    (v) => (v.trim().length > 0 ? null : "codex_model must be non-empty"),
  );
  if (codexModel === null) {
    io.write("Settings update canceled. Nothing was saved.\n");
    return;
  }
  const codexEffort = await askChoice(
    io,
    `codex_effort [${defaults.codex_effort}] (low/medium/high): `,
    defaults.codex_effort,
    ["low", "medium", "high"] as const,
    "invalid codex_effort",
  );
  if (codexEffort === null) {
    io.write("Settings update canceled. Nothing was saved.\n");
    return;
  }
  const claudeModel = await askValue(
    io,
    `claude_model [${defaults.claude_model}]: `,
    defaults.claude_model,
    (v) => (v.trim().length > 0 ? null : "claude_model must be non-empty"),
  );
  if (claudeModel === null) {
    io.write("Settings update canceled. Nothing was saved.\n");
    return;
  }
  const claudeEffort = await askChoice(
    io,
    `claude_effort [${defaults.claude_effort}] (low/medium/high): `,
    defaults.claude_effort,
    ["low", "medium", "high"] as const,
    "invalid claude_effort",
  );
  if (claudeEffort === null) {
    io.write("Settings update canceled. Nothing was saved.\n");
    return;
  }

  saveAndReport(cwd, io, {
    provider,
    kind,
    model: normalizeModelToken(model),
    effort,
    language,
    execution_mode: executionMode,
    command,
    args,
    timeout_ms: timeoutMs,
    api_base: apiBase,
    api_key: apiKey,
    api_key_env: apiKeyEnv,
    api_format: apiFormat,
    codex_model: normalizeModelToken(codexModel),
    codex_effort: codexEffort,
    claude_model: normalizeModelToken(claudeModel),
    claude_effort: claudeEffort,
  });
}

export function persistConversationSettings(cwd: string, values: SettingsValues): string {
  const cfgPath = resolveWritePath(cwd);
  const prev = readExistingConfig(cfgPath);
  const maybeApiFields = {
    ...(values.api_base.trim().length > 0 ? { api_base: values.api_base.trim() } : {}),
    ...(values.api_key.trim().length > 0 ? { api_key: values.api_key.trim() } : {}),
    ...(values.api_key_env.trim().length > 0 ? { api_key_env: values.api_key_env.trim() } : {}),
    ...(values.kind === "api" ? { api_format: values.api_format } : {}),
  };
  const next = RelayConfigSchema.parse({
    ...prev,
    overseer: {
      ...(prev.overseer ?? {}),
      provider: values.provider,
      kind: values.kind,
      model: values.model,
      effort: values.effort,
      language: values.language,
      execution_mode: values.execution_mode,
      command: values.command,
      args: values.args,
      timeout_ms: values.timeout_ms,
      ...maybeApiFields,
      codex_model: values.codex_model,
      codex_effort: values.codex_effort,
      claude_model: values.claude_model,
      claude_effort: values.claude_effort,
    },
  });

  mkdirSync(dirname(cfgPath), { recursive: true });
  writeFileSync(cfgPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return cfgPath;
}

export async function runSettingsWizard(
  cwd: string,
  io: { write: (text: string) => unknown; ask?: (prompt: string) => Promise<string> },
): Promise<void> {
  const defaults = normalizeDefaults(cwd);
  const rl = io.ask ? null : createInterface({ input: process.stdin, output: process.stdout });
  const promptIO: PromptIO = {
    write: io.write,
    ask: io.ask ?? ((prompt: string) => new Promise((resolvePrompt) => (rl as Interface).question(prompt, resolvePrompt))),
  };

  try {
    printHeader(promptIO, defaults);
    const flow = await askChoice(
      promptIO,
      "flow [quick/advanced/preset/pool/show/cancel] [quick]: ",
      "quick",
      FLOW_OPTIONS,
      "invalid flow option",
    );

    if (flow === null || flow === "cancel") {
      promptIO.write("Settings update canceled. Nothing was saved.\n");
      return;
    }
    if (flow === "show") {
      promptIO.write("No changes made.\n");
      return;
    }

    if (flow === "preset") {
      const continueToCustom = await runPresetFlow(cwd, promptIO, defaults);
      if (!continueToCustom) return;
    }

    if (flow === "quick") {
      await runQuickFlow(cwd, promptIO, defaults);
      return;
    }
    if (flow === "pool") {
      await runPoolFlow(cwd, promptIO, defaults);
      return;
    }

    await runAdvancedFlow(cwd, promptIO, defaults);
  } finally {
    rl?.close();
  }
}

export async function runProviderSetupWizard(
  cwd: string,
  io: { write: (text: string) => unknown; ask?: (prompt: string) => Promise<string> },
): Promise<void> {
  const defaults = normalizeDefaults(cwd);
  const rl = io.ask ? null : createInterface({ input: process.stdin, output: process.stdout });
  const promptIO: PromptIO = {
    write: io.write,
    ask:
      io.ask ??
      ((prompt: string) =>
        new Promise((resolvePrompt) => (rl as Interface).question(prompt, resolvePrompt))),
  };

  try {
    promptIO.write("RelayOS Setup Wizard\n");
    promptIO.write("Configure primary/backup AI providers for conversation mode.\n");
    promptIO.write(
      "Official API providers: Codex/OpenAI, Claude/Anthropic, GLM/Zhipu. Custom requires danger confirmation.\n\n",
    );
    await runPoolFlow(cwd, promptIO, defaults);
  } finally {
    rl?.close();
  }
}
