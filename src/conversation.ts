import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { RelayConfig } from "./schema.js";

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

interface ResolvedConversationProviderConfig {
  provider: string;
  kind: "subscription" | "api" | "fallback" | "subscription_cli" | "local_command";
  model: string;
  effort: string | null;
  executionMode: string | null;
  command: string | null;
  args: string[];
  timeoutMs: number;
}

class ConfiguredConversationProvider implements ConversationProvider {
  constructor(private readonly cfg: ResolvedConversationProviderConfig) {}

  async chat(messages: ConversationMessage[]): Promise<string> {
    const latestUser = [...messages].reverse().find((m) => m.role === "user");
    const providerLabel = `${this.cfg.provider}/${this.cfg.model} [${this.cfg.kind}]`;
    if (!latestUser) {
      return `provider-configured-but-not-executable: ${providerLabel} configured, but no user message was provided.`;
    }
    if (!isExecutableMode(this.cfg.executionMode) || !this.cfg.command) {
      return `provider-configured-but-not-executable: ${providerLabel} is configured, but no executable command is set for execution_mode local_command/subscription_cli.`;
    }
    return runLocalCommandProvider(this.cfg, latestUser.content, providerLabel);
  }
}

function isExecutableMode(mode: string | null): boolean {
  return mode === "local_command" || mode === "subscription_cli";
}

async function runLocalCommandProvider(
  cfg: ResolvedConversationProviderConfig,
  userMessage: string,
  providerLabel: string,
): Promise<string> {
  const effort = cfg.effort ?? "medium";
  const hasInputPlaceholder = cfg.args.some((arg) => arg.includes("{{input}}"));
  const argv = cfg.args.map((arg) =>
    arg.replaceAll("{{input}}", userMessage).replaceAll("{{model}}", cfg.model).replaceAll("{{effort}}", effort)
  );

  // subscription_cli is typically non-interactive and should not wait on stdin.
  // If no {{input}} placeholder exists, pass user input as a positional arg.
  if (cfg.executionMode === "subscription_cli" && !hasInputPlaceholder) {
    argv.push(userMessage);
  }

  const useStdin = cfg.executionMode === "local_command" && !hasInputPlaceholder;

  const result = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    spawnError: string | null;
  }>((resolve) => {
    const child = spawn(cfg.command as string, argv, {
      shell: false,
      stdio: [useStdin ? "pipe" : "ignore", "pipe", "pipe"],
      windowsHide: true,
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

    if (useStdin && child.stdin) {
      child.stdin.end(`${userMessage}\n`);
    }
  });

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
  return { provider: providerName, kind, model, effort, executionMode, command, args, timeoutMs };
}

export function resolveConversationProvider(config: RelayConfig): ConversationProvider | null {
  const providerConfig = resolveConversationProviderConfig(config);
  if (!providerConfig) return null;
  return new ConfiguredConversationProvider(providerConfig);
}

async function appendConversationLog(messages: ConversationMessage[]): Promise<void> {
  const dir = join(process.cwd(), ".relayos", "overseer");
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
): Promise<ConversationResult> {
  const provider = resolveConversationProvider(config);
  if (!provider) {
    await appendConversationLog(messages);
    return {
      reply:
        "provider-not-configured: set overseer.provider, overseer.kind, and overseer.model in .relayos/config.json.",
      providerUsed: null,
      configured: false,
    };
  }

  const reply = await provider.chat(messages);
  await appendConversationLog([...messages, { role: "assistant", content: reply }]);
  const resolved = resolveConversationProviderConfig(config);
  return {
    reply,
    providerUsed: resolved ? `${resolved.provider}/${resolved.model}/${resolved.kind}` : "configured",
    configured: true,
  };
}
