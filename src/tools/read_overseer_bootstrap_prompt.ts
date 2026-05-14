import { z } from "zod";
import { readOverseerHandshakeSnapshot } from "../overseer.js";

export const ReadOverseerBootstrapPromptInput = z.object({}).strict();
export type ReadOverseerBootstrapPromptInput = z.infer<
  typeof ReadOverseerBootstrapPromptInput
>;

export interface BootstrapToolCall {
  tool: string;
  input: Record<string, unknown>;
}

export interface ReadOverseerBootstrapPromptResult {
  ok: boolean;
  protocol: "relayos-overseer-session-v1";
  tool: "read_overseer_bootstrap_prompt";
  prompt: string;
  recommended_first_calls: BootstrapToolCall[];
  safety_boundaries: string[];
  notes: string[];
}

function buildPrompt(): string {
  return [
    "RelayOS Overseer Session Bootstrap (Protocol v1)",
    "",
    "1) Call read_overseer_handshake {} first.",
    "2) Call read_overseer_recent {\"limit\":8} second.",
    "3) If handshake ok/context_complete is false: report missing files and wait for explicit user approval before any edits.",
    "4) If handshake ok/context_complete is true: treat the returned protocol as the active session contract.",
    "5) Follow must_read, next_action_source, forbidden_actions, and requires_explicit_user_approval_for exactly.",
    "6) Do not edit files until the user approves a scoped task.",
    "7) Recommend exactly one next safe action based on handshake + recent state.",
    "8) Do not free-form \"Implement {feature}\" without explicit user-scoped approval.",
    "9) Do not commit/push/tag/release without explicit user approval.",
    "10) After completing approved work, call write_overseer_note to record progress.",
  ].join("\n");
}

export async function readOverseerBootstrapPrompt(
  rawInput: unknown,
): Promise<ReadOverseerBootstrapPromptResult> {
  ReadOverseerBootstrapPromptInput.parse(rawInput ?? {});
  const handshake = await readOverseerHandshakeSnapshot(process.cwd());
  return {
    ok: handshake.ok,
    protocol: handshake.protocol,
    tool: "read_overseer_bootstrap_prompt",
    prompt: buildPrompt(),
    recommended_first_calls: [
      { tool: "read_overseer_handshake", input: {} },
      { tool: "read_overseer_recent", input: { limit: 8 } },
    ],
    safety_boundaries: [
      ...handshake.forbidden_actions,
      "No commit/push/tag/release without explicit user approval.",
      "No file edits before user approves a scoped task.",
    ],
    notes: [
      ...handshake.notes,
      "Bootstrap prompt is read-only and does not create or modify local files.",
      "Use write_overseer_note after approved tasks to keep local progress timeline current.",
    ],
  };
}
