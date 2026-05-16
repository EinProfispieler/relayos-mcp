import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface, type Interface } from "node:readline";
import type { RelayConfig } from "./schema.js";
import { RelayConfig as RelayConfigSchema } from "./schema.js";
import { loadProjectConfig } from "./config.js";

const CONFIG_DIR = ".relayos";
const CONFIG_FILE = "config.json";
const CANCEL_TOKENS = new Set(["/cancel", "cancel"]);

const KIND_OPTIONS = ["subscription", "api", "fallback", "subscription_cli", "local_command"] as const;
const EXECUTION_MODE_OPTIONS = ["subscription_cli", "local_command"] as const;
const LANGUAGE_OPTIONS = ["english", "chinese"] as const;
const FLOW_OPTIONS = ["quick", "advanced", "preset", "show", "cancel"] as const;
const PRESET_OPTIONS = ["codex-gpt55", "codex-codex53", "custom", "cancel"] as const;

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
  codex_model: string;
  codex_effort: "low" | "medium" | "high";
  claude_model: string;
  claude_effort: "low" | "medium" | "high";
}

interface PromptIO {
  write: (text: string) => unknown;
  ask: (prompt: string) => Promise<string>;
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
  const codexModel = current?.codex_model;
  const codexEffort = current?.codex_effort;
  const claudeModel = current?.claude_model;
  const claudeEffort = current?.claude_effort;

  return {
    provider: typeof provider === "string" ? provider : "codex",
    kind: KIND_OPTIONS.includes(kind as SettingsValues["kind"]) ? (kind as SettingsValues["kind"]) : "subscription_cli",
    model: typeof model === "string" && model.trim().length > 0 ? model : "gpt-5.3-codex",
    effort: typeof effort === "string" && effort.trim().length > 0 ? effort : "medium",
    language: language === "chinese" ? "chinese" : "english",
    execution_mode:
      EXECUTION_MODE_OPTIONS.includes(executionMode as SettingsValues["execution_mode"])
        ? (executionMode as SettingsValues["execution_mode"])
        : "subscription_cli",
    command: typeof command === "string" && command.trim().length > 0 ? command : "codex",
    args:
      Array.isArray(args) && args.length > 0
        ? args
        : [
            "exec",
            "--model",
            "{{model}}",
            "-c",
            "model_reasoning_effort={{effort}}",
            "--sandbox",
            "read-only",
            "{{input}}",
          ],
    timeout_ms: typeof timeout === "number" && Number.isInteger(timeout) && timeout > 0 ? timeout : 120000,
    codex_model:
      typeof codexModel === "string" && codexModel.trim().length > 0
        ? codexModel
        : "gpt-5.5",
    codex_effort:
      codexEffort === "low" || codexEffort === "medium" || codexEffort === "high"
        ? codexEffort
        : "high",
    claude_model:
      typeof claudeModel === "string" && claudeModel.trim().length > 0
        ? claudeModel
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

function printHeader(io: PromptIO, defaults: SettingsValues): void {
  io.write("RelayOS provider settings (local CLI only, no API keys)\n");
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

async function runPresetFlow(cwd: string, io: PromptIO, defaults: SettingsValues): Promise<boolean> {
  const preset = await askChoice(
    io,
    "preset [codex-gpt55/codex-codex53/custom/cancel] [custom]: ",
    "custom",
    PRESET_OPTIONS,
    "invalid preset",
  );
  if (preset === null || preset === "cancel") {
    io.write("Settings update canceled. Nothing was saved.\n");
    return false;
  }
  if (preset === "custom") return true;
  const values =
    preset === "codex-gpt55"
      ? codexPreset("gpt-5.5", defaults.timeout_ms)
      : codexPreset("gpt-5.3-codex", defaults.timeout_ms);
  saveAndReport(cwd, io, values);
  return false;
}

async function runQuickFlow(cwd: string, io: PromptIO, defaults: SettingsValues): Promise<void> {
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

  const timeoutMs = await askPositiveInt(io, `timeout_ms [${defaults.timeout_ms}]: `, defaults.timeout_ms);
  if (timeoutMs === null) {
    io.write("Settings update canceled. Nothing was saved.\n");
    return;
  }

  saveAndReport(cwd, io, {
    ...defaults,
    model,
    effort,
    language,
    timeout_ms: timeoutMs,
  });
}

async function runAdvancedFlow(cwd: string, io: PromptIO, defaults: SettingsValues): Promise<void> {
  const provider = await askValue(io, `provider [${defaults.provider}]: `, defaults.provider, (v) =>
    v.trim().length > 0 ? null : "provider must be non-empty",
  );
  if (provider === null) {
    io.write("Settings update canceled. Nothing was saved.\n");
    return;
  }

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

  const command = await askValue(io, `command [${defaults.command}]: `, defaults.command, (v) =>
    v.trim().length > 0 ? null : "command must be non-empty for local_command/subscription_cli",
  );
  if (command === null) {
    io.write("Settings update canceled. Nothing was saved.\n");
    return;
  }

  const argsRaw = await io.ask(`args (JSON array or shell-like string) [${defaults.args.join(" ")}]: `);
  if (isCanceled(argsRaw)) {
    io.write("Settings update canceled. Nothing was saved.\n");
    return;
  }
  const args = splitArgs(withFallback(argsRaw, defaults.args.join(" ")));
  if (args.length === 0) {
    io.write("args cannot be empty\n");
    return;
  }
  if (!args.includes("{{input}}")) {
    io.write("args must include {{input}} placeholder\n");
    return;
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
    model,
    effort,
    language,
    execution_mode: executionMode,
    command,
    args,
    timeout_ms: timeoutMs,
    codex_model: codexModel,
    codex_effort: codexEffort,
    claude_model: claudeModel,
    claude_effort: claudeEffort,
  });
}

export function persistConversationSettings(cwd: string, values: SettingsValues): string {
  const cfgPath = resolveWritePath(cwd);
  const prev = readExistingConfig(cfgPath);
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
      "flow [quick/advanced/preset/show/cancel] [quick]: ",
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

    await runAdvancedFlow(cwd, promptIO, defaults);
  } finally {
    rl?.close();
  }
}
