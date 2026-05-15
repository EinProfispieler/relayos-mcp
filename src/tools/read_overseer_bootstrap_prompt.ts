import { z } from "zod";
import { buildOverseerRoleProfile, readOverseerHandshakeSnapshot } from "../overseer.js";

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
  const startupSequence = buildOverseerRoleProfile().startup_sequence;
  const remainingStartupSequence = startupSequence.slice(1);
  const startupLines = remainingStartupSequence.map(
    (toolName, idx) =>
      `${idx + 2}) Call ${formatToolCallForPrompt(toolName)} ${
        idx === 0 ? "next" : "after that"
      }.`,
  );

  return [
    "RelayOS Overseer Session Bootstrap (Protocol v1)",
    "",
    "1) Call read_overseer_role_profile {} first.",
    ...startupLines,
    `${startupLines.length + 2}) Follow startup_sequence exactly; do not skip or reorder startup calls.`,
    `${startupLines.length + 3}) If handshake ok/context_complete is false: report missing files and wait for explicit user approval before any edits.`,
    `${startupLines.length + 4}) If handshake ok/context_complete is true: treat the returned protocol as the active session contract.`,
    `${startupLines.length + 5}) Follow must_read, next_action_source, forbidden_actions, and requires_explicit_user_approval_for exactly.`,
    `${startupLines.length + 6}) Do not edit files until the user approves a scoped task.`,
    `${startupLines.length + 7}) Validation-only workspace-write requires explicit user approval first.`,
    `${startupLines.length + 8}) After approval, delegate a validation-only implementation worker and require final git status plus evidence in the report.`,
    `${startupLines.length + 9}) Recommend exactly one next safe action based on handshake + summary state.`,
    `${startupLines.length + 10}) Do not free-form \"Implement {feature}\" without explicit user-scoped approval.`,
    `${startupLines.length + 11}) Do not commit/push/tag/release without explicit user approval.`,
    `${startupLines.length + 12}) After completing approved scoped handoff work, call write_handoff_result with run_id, status, summary, tests_run/test_result when applicable, blockers when applicable, and needs_review/requires_user_approval flags as needed.`,
    `${startupLines.length + 13}) After completing approved work, call write_overseer_note to record progress.`,
  ].join("\n");
}

function toolInputForBootstrapCall(tool: string): Record<string, unknown> {
  if (
    tool === "read_overseer_memory_index" ||
    tool === "read_overseer_summary" ||
    tool === "read_overseer_context_pack" ||
    tool === "read_overseer_recent" ||
    tool === "read_overseer_decisions" ||
    tool === "read_handoff_results"
  ) {
    return { limit: 8 };
  }
  return {};
}

function formatToolCallForPrompt(tool: string): string {
  const input = toolInputForBootstrapCall(tool);
  if (Object.keys(input).length === 0) return `${tool} {}`;
  return `${tool} ${JSON.stringify(input)}`;
}

export async function readOverseerBootstrapPrompt(
  rawInput: unknown,
): Promise<ReadOverseerBootstrapPromptResult> {
  ReadOverseerBootstrapPromptInput.parse(rawInput ?? {});
  const handshake = await readOverseerHandshakeSnapshot(process.cwd());
  const startupSequence = buildOverseerRoleProfile().startup_sequence;
  return {
    ok: handshake.ok,
    protocol: handshake.protocol,
    tool: "read_overseer_bootstrap_prompt",
    prompt: buildPrompt(),
    recommended_first_calls: startupSequence.map((tool) => ({
      tool,
      input: toolInputForBootstrapCall(tool),
    })),
    safety_boundaries: [
      ...handshake.forbidden_actions,
      "No commit/push/tag/release without explicit user approval.",
      "No file edits before user approves a scoped task.",
    ],
    notes: [
      ...handshake.notes,
      "Bootstrap prompt is read-only and does not create or modify local files.",
      "Validation-only workspace-write requires explicit user approval before any write action.",
      "After validation-only approval, delegate a validation-only worker and require final git status plus evidence in the report.",
      "Use write_handoff_result after approved scoped handoff execution to append structured result evidence.",
      "Use write_overseer_note after approved tasks to keep local progress timeline current.",
    ],
  };
}
