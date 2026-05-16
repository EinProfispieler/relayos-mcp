import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface, type Interface } from "node:readline";
import type { RelayConfig } from "./schema.js";
import { RelayConfig as RelayConfigSchema } from "./schema.js";
import { loadProjectConfig } from "./config.js";

const CONFIG_DIR = ".relayos";
const CONFIG_FILE = "config.json";
const CANCEL_TOKEN = "/cancel";
const CANCEL_WORD = "cancel";
const KIND_OPTIONS = new Set<SettingsValues["kind"]>([
  "subscription",
  "api",
  "fallback",
  "subscription_cli",
  "local_command",
]);
const EXECUTION_MODE_OPTIONS = new Set<SettingsValues["execution_mode"]>([
  "subscription_cli",
  "local_command",
]);

export interface SettingsValues {
  provider: string;
  kind: "subscription" | "api" | "fallback" | "subscription_cli" | "local_command";
  model: string;
  effort: string;
  execution_mode: "local_command" | "subscription_cli";
  command: string;
  args: string[];
  timeout_ms: number;
}

type SettingsPreset = "codex-gpt55" | "codex-codex53" | "custom" | "cancel";

const PRESET_OPTIONS = new Set<SettingsPreset>(["codex-gpt55", "codex-codex53", "custom", "cancel"]);

function splitArgs(raw: string): string[] {
  const s = raw.trim();
  if (s.length === 0) return [];
  if (s.startsWith("[")) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
        return parsed;
      }
    } catch {
      // fall through to shell-like parse
    }
  }

  const out: string[] = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  for (const match of s.matchAll(re)) {
    const token = match[1] ?? match[2] ?? match[3] ?? "";
    out.push(token.replace(/\\(["'\\])/g, "$1"));
  }
  return out;
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
      execution_mode: values.execution_mode,
      command: values.command,
      args: values.args,
      timeout_ms: values.timeout_ms,
    },
  });

  mkdirSync(dirname(cfgPath), { recursive: true });
  writeFileSync(cfgPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return cfgPath;
}

function ask(rl: Interface, prompt: string): Promise<string> {
  return new Promise((resolvePrompt) => {
    rl.question(prompt, (answer) => resolvePrompt(answer));
  });
}

function nonEmpty(answer: string, fallback: string): string {
  const v = answer.trim();
  return v.length > 0 ? v : fallback;
}

function isCancelInput(input: string): boolean {
  const value = input.trim().toLowerCase();
  return value === CANCEL_TOKEN || value === CANCEL_WORD;
}

function codexPreset(model: string): SettingsValues {
  return {
    provider: "codex",
    kind: "subscription_cli",
    model,
    effort: "medium",
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
    timeout_ms: 120000,
  };
}

function mergeWithDefaults(base: SettingsValues, patch: Partial<SettingsValues>): SettingsValues {
  return {
    ...base,
    ...patch,
    args: patch.args ?? base.args,
  };
}

export async function runSettingsWizard(
  cwd: string,
  io: { write: (text: string) => unknown; ask?: (prompt: string) => Promise<string> },
): Promise<void> {
  const loaded = loadProjectConfig({ cwd });
  const current = loaded.config.overseer;

  const defaults: SettingsValues = {
    provider: typeof current?.provider === "string" ? current.provider : "codex",
    kind: current?.kind ?? "subscription_cli",
    model: current?.model ?? "gpt-5.3-codex",
    effort: current?.effort ?? "medium",
    execution_mode:
      current?.execution_mode === "local_command" || current?.execution_mode === "subscription_cli"
        ? current.execution_mode
        : "subscription_cli",
    command: current?.command ?? "codex",
    args:
      current?.args ?? [
        "exec",
        "--model",
        "{{model}}",
        "-c",
        "model_reasoning_effort={{effort}}",
        "--sandbox",
        "read-only",
        "{{input}}",
      ],
    timeout_ms: current?.timeout_ms ?? 120000,
  };

  io.write("RelayOS provider settings (local CLI only, no API keys)\n");
  io.write("Press Enter to keep current value.\n");
  io.write("Type /cancel or cancel at any prompt to abort without saving.\n");

  const rl = io.ask ? null : createInterface({ input: process.stdin, output: process.stdout });
  const askPrompt = io.ask ?? ((prompt: string) => ask(rl as Interface, prompt));

  const askField = async (
    prompt: string,
    fallback: string,
    validate: (value: string) => string | null,
  ): Promise<string | null> => {
    while (true) {
      const raw = await askPrompt(prompt);
      if (isCancelInput(raw)) return null;
      const value = nonEmpty(raw, fallback).trim();
      const err = validate(value);
      if (!err) return value;
      io.write(`${err}\n`);
    }
  };

  try {
    const presetRaw = await askPrompt("preset [codex-gpt55/codex-codex53/custom/cancel] [custom]: ");
    if (isCancelInput(presetRaw)) {
      io.write("Settings update canceled. Nothing was saved.\n");
      return;
    }
    const preset = nonEmpty(presetRaw, "custom").toLowerCase();
    if (!PRESET_OPTIONS.has(preset as SettingsPreset)) {
      io.write("invalid preset\n");
      io.write("Settings update canceled. Nothing was saved.\n");
      return;
    }
    if (preset === "cancel") {
      io.write("Settings update canceled. Nothing was saved.\n");
      return;
    }
    if (preset === "codex-gpt55" || preset === "codex-codex53") {
      const values = preset === "codex-gpt55" ? codexPreset("gpt-5.5") : codexPreset("gpt-5.3-codex");
      const path = persistConversationSettings(cwd, values);
      io.write(`Saved settings to ${path}\n`);
      io.write(
        `Provider route: ${values.provider}/${values.model}/${values.kind} via ${values.execution_mode}\n`,
      );
      return;
    }

    const quickRaw = await askPrompt("quick setup [keep/custom] [keep]: ");
    if (isCancelInput(quickRaw)) {
      io.write("Settings update canceled. Nothing was saved.\n");
      return;
    }
    const quick = nonEmpty(quickRaw, "keep").toLowerCase();
    if (quick !== "keep" && quick !== "custom") {
      io.write("invalid quick setup option\n");
      io.write("Settings update canceled. Nothing was saved.\n");
      return;
    }

    if (quick === "keep") {
      const modelQuick = await askField(`model [${defaults.model}]: `, defaults.model, (value) =>
        value.length > 0 ? null : "model must be non-empty",
      );
      if (modelQuick === null) {
        io.write("Settings update canceled. Nothing was saved.\n");
        return;
      }
      const effortQuick = await askField(`effort [${defaults.effort}]: `, defaults.effort, () => null);
      if (effortQuick === null) {
        io.write("Settings update canceled. Nothing was saved.\n");
        return;
      }
      const timeoutQuickRaw = await askField(
        `timeout_ms [${defaults.timeout_ms}]: `,
        String(defaults.timeout_ms),
        (value) => {
          const parsed = Number.parseInt(value, 10);
          if (!/^\d+$/.test(value) || !Number.isInteger(parsed) || parsed <= 0) {
            return "timeout_ms must be a positive integer";
          }
          return null;
        },
      );
      if (timeoutQuickRaw === null) {
        io.write("Settings update canceled. Nothing was saved.\n");
        return;
      }
      const timeoutQuick = Number.parseInt(timeoutQuickRaw, 10);
      const path = persistConversationSettings(
        cwd,
        mergeWithDefaults(defaults, { model: modelQuick, effort: effortQuick, timeout_ms: timeoutQuick }),
      );
      io.write(`Saved settings to ${path}\n`);
      io.write(
        `Provider route: ${defaults.provider}/${modelQuick}/${defaults.kind} via ${defaults.execution_mode}\n`,
      );
      return;
    }

    const provider = await askField(`provider [${defaults.provider}]: `, defaults.provider, (value) =>
      value.length > 0 ? null : "provider must be non-empty",
    );
    if (provider === null) {
      io.write("Settings update canceled. Nothing was saved.\n");
      return;
    }

    const kind = await askField(
      `kind [${defaults.kind}] (subscription/api/fallback/subscription_cli/local_command): `,
      defaults.kind,
      (value) => (KIND_OPTIONS.has(value as SettingsValues["kind"]) ? null : "invalid kind"),
    );
    if (kind === null) {
      io.write("Settings update canceled. Nothing was saved.\n");
      return;
    }

    const model = await askField(`model [${defaults.model}]: `, defaults.model, (value) =>
      value.length > 0 ? null : "model must be non-empty",
    );
    if (model === null) {
      io.write("Settings update canceled. Nothing was saved.\n");
      return;
    }

    const effort = await askField(`effort [${defaults.effort}]: `, defaults.effort, () => null);
    if (effort === null) {
      io.write("Settings update canceled. Nothing was saved.\n");
      return;
    }

    const execution_mode = await askField(
      `execution_mode [${defaults.execution_mode}] (subscription_cli/local_command): `,
      defaults.execution_mode,
      (value) =>
        EXECUTION_MODE_OPTIONS.has(value as SettingsValues["execution_mode"]) ? null : "invalid execution_mode",
    );
    if (execution_mode === null) {
      io.write("Settings update canceled. Nothing was saved.\n");
      return;
    }

    const command = await askField(`command [${defaults.command}]: `, defaults.command, (value) => {
      if ((execution_mode === "local_command" || execution_mode === "subscription_cli") && value.length === 0) {
        return "command must be non-empty for local_command/subscription_cli";
      }
      return null;
    });
    if (command === null) {
      io.write("Settings update canceled. Nothing was saved.\n");
      return;
    }

    const argsRaw = await askPrompt(
      `args (JSON array or shell-like string) [${defaults.args.join(" ")}]: `,
    );
    if (isCancelInput(argsRaw)) {
      io.write("Settings update canceled. Nothing was saved.\n");
      return;
    }
    const argTemplate = splitArgs(nonEmpty(argsRaw, defaults.args.join(" ")));

    const timeoutRaw = await askField(`timeout_ms [${defaults.timeout_ms}]: `, String(defaults.timeout_ms), (value) => {
      const parsed = Number.parseInt(value, 10);
      if (!/^\d+$/.test(value) || !Number.isInteger(parsed) || parsed <= 0) {
        return "timeout_ms must be a positive integer";
      }
      return null;
    });
    if (timeoutRaw === null) {
      io.write("Settings update canceled. Nothing was saved.\n");
      return;
    }
    const timeout_ms = Number.parseInt(timeoutRaw, 10);

    const path = persistConversationSettings(cwd, {
      provider,
      kind: kind as SettingsValues["kind"],
      model,
      effort,
      execution_mode: execution_mode as SettingsValues["execution_mode"],
      command,
      args: argTemplate,
      timeout_ms,
    });

    io.write(`Saved settings to ${path}\n`);
    io.write(`Provider route: ${provider}/${model}/${kind} via ${execution_mode}\n`);
  } finally {
    rl?.close();
  }
}
