import { appendFile, mkdir, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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

export interface ConversationScope {
  projectRoot: string;
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
    if (!isExecutableMode(this.cfg.executionMode) || !this.cfg.command) {
      return `provider-configured-but-not-executable: ${providerLabel} is configured, but no executable command is set for execution_mode local_command/subscription_cli.`;
    }
    return runLocalCommandProvider(this.cfg, this.scope, latestUser.content, providerLabel);
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
  const scopedInput = buildScopedProviderInput(scope.projectRoot, userMessage);
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

  const before = await snapshotProjectTree(scope.projectRoot);
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

  const mutated = await rollbackProjectMutations(scope.projectRoot, before);
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
  return {
    provider: providerName,
    kind,
    model: normalizeModelId(model),
    effort,
    executionMode,
    command,
    args,
    timeoutMs,
  };
}

export function resolveConversationProvider(
  config: RelayConfig,
  scope: ConversationScope,
): ConversationProvider | null {
  const providerConfig = resolveConversationProviderConfig(config);
  if (!providerConfig) return null;
  return new ConfiguredConversationProvider(providerConfig, scope);
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
  scope: ConversationScope,
): Promise<ConversationResult> {
  const provider = resolveConversationProvider(config, scope);
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

function buildScopedProviderInput(projectRoot: string, userMessage: string): string {
  return [
    "SYSTEM BOUNDARY INSTRUCTIONS:",
    `- Allowed context is only the current project/worktree root: ${projectRoot}`,
    "- Do not read, cite, summarize, or rely on files outside this project/worktree.",
    "- Do not read ~/.agent-access.md or any home-directory files unless the user explicitly approves it.",
    "- If outside-project context is needed, ask for approval before reading it.",
    "- Do not edit files.",
    "- Do not run shell commands.",
    "- Do not claim any tests/builds/commands were executed.",
    "- Always return a normal human-facing answer.",
    "- If the user appears to be asking for project work, you may append one optional ACTION_INTENT block at the end.",
    "- ACTION_INTENT format:",
    "ACTION_INTENT",
    "intent_type: conversation | create_task | create_handoff | review | release_control",
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
