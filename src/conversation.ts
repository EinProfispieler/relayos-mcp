import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
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

interface ResolvedOverseerConfig {
  provider: string;
  model: string;
}

class ConfiguredConversationProvider implements ConversationProvider {
  constructor(private readonly cfg: ResolvedOverseerConfig) {}

  async chat(messages: ConversationMessage[]): Promise<string> {
    const latestUser = [...messages].reverse().find((m) => m.role === "user");
    const providerLabel = `${this.cfg.provider}/${this.cfg.model}`;
    if (!latestUser) {
      return `Conversation provider configured (${providerLabel}), but no user message was provided.`;
    }
    return `Conversation provider configured (${providerLabel}), but no RelayOS provider adapter is currently implemented for direct chat responses.`;
  }
}

function resolveOverseerConfig(config: RelayConfig): ResolvedOverseerConfig | null {
  const provider = config.overseer?.provider?.trim();
  const model = config.overseer?.model?.trim();
  if (!provider || !model) return null;
  return { provider, model };
}

export function resolveConversationProvider(config: RelayConfig): ConversationProvider | null {
  const overseerConfig = resolveOverseerConfig(config);
  if (!overseerConfig) return null;
  return new ConfiguredConversationProvider(overseerConfig);
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
        "AI conversation provider not configured. Set overseer.provider and overseer.model in .relayos/config.json.",
      providerUsed: null,
      configured: false,
    };
  }

  const reply = await provider.chat(messages);
  await appendConversationLog([...messages, { role: "assistant", content: reply }]);
  const resolved = resolveOverseerConfig(config);
  return {
    reply,
    providerUsed: resolved ? `${resolved.provider}/${resolved.model}` : "configured",
    configured: true,
  };
}
