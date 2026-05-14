import { join } from "node:path";
import { z } from "zod";
import {
  readLatestNotes,
  readNextAction,
  readOverseerContextSnapshot,
  readOverseerHandshakeSnapshot,
  readOverseerTextFile,
  resolveOverseerLayout,
} from "../overseer.js";

export const ReadOverseerContextPackInput = z
  .object({
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict();
export type ReadOverseerContextPackInput = z.infer<
  typeof ReadOverseerContextPackInput
>;

export interface OverseerContextPackNote {
  ts: string;
  text: string;
}

export interface ReadOverseerContextPackResult {
  ok: boolean;
  protocol: "relayos-overseer-session-v1";
  tool: "read_overseer_context_pack";
  context_complete: boolean;
  missing: string[];
  workspace_path: string;
  project_summary: string | null;
  current_state: string | null;
  next_action: string | null;
  recent_notes: OverseerContextPackNote[];
  notes_count: number;
  limit: number;
  forbidden_actions: string[];
  model_policy: string | null;
  recommended_prompt: string;
  evidence_links: string[];
  notes: string[];
}

function compactText(value: string | null): string | null {
  if (!value) return null;
  for (const raw of value.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    return line.length <= 280 ? line : `${line.slice(0, 277)}...`;
  }
  const single = value.replace(/\s+/g, " ").trim();
  if (!single) return null;
  return single.length <= 280 ? single : `${single.slice(0, 277)}...`;
}

function buildRecommendedPrompt(): string {
  return [
    "Call read_overseer_handshake {} and read_overseer_recent {\"limit\":8}, then recommend exactly one next safe action.",
    "If handshake ok/context_complete is false, report missing files and wait for explicit user approval before any edits.",
    "Do not edit files until the user approves a scoped task.",
  ].join(" ");
}

function buildEvidenceLinks(cwd: string): string[] {
  const base = join(cwd, ".relayos", "overseer");
  return [
    join(base, "PROJECT_BRIEF.md"),
    join(base, "CURRENT_STATE.md"),
    join(base, "NEXT_ACTION.md"),
    join(base, "FORBIDDEN_ACTIONS.md"),
    join(base, "MODEL_POLICY.md"),
    join(base, "timeline.jsonl"),
    join(cwd, "docs", "ROADMAP.md"),
    join(cwd, "docs", "CURATED_MEMORY.md"),
    join(cwd, "docs", "SCOPED_ROOKIE_RUNTIME.md"),
  ];
}

export async function readOverseerContextPack(
  rawInput: unknown,
): Promise<ReadOverseerContextPackResult> {
  const input = ReadOverseerContextPackInput.parse(rawInput ?? {});
  const limit = input.limit ?? 8;
  const cwd = process.cwd();
  const layout = resolveOverseerLayout(cwd);

  const [context, handshake, projectBriefRaw, currentStateRaw, nextActionRaw, modelPolicyRaw, notes] =
    await Promise.all([
      readOverseerContextSnapshot(cwd),
      readOverseerHandshakeSnapshot(cwd),
      readOverseerTextFile(layout, "PROJECT_BRIEF.md"),
      readOverseerTextFile(layout, "CURRENT_STATE.md"),
      readNextAction(layout),
      readOverseerTextFile(layout, "MODEL_POLICY.md"),
      readLatestNotes(layout, limit),
    ]);

  return {
    ok: context.ok,
    protocol: handshake.protocol,
    tool: "read_overseer_context_pack",
    context_complete: context.ok,
    missing: context.missing,
    workspace_path: context.workspace_path,
    project_summary: compactText(projectBriefRaw),
    current_state: compactText(currentStateRaw),
    next_action: compactText(nextActionRaw),
    recent_notes: notes.map((n) => ({ ts: n.ts, text: n.text })),
    notes_count: notes.length,
    limit,
    forbidden_actions: handshake.forbidden_actions,
    model_policy: compactText(modelPolicyRaw),
    recommended_prompt: buildRecommendedPrompt(),
    evidence_links: buildEvidenceLinks(cwd),
    notes: [
      "Curated context pack is compact by design; no raw full chat transcript sync.",
      "Read-only tool: does not create, modify, or delete .relayos/overseer files.",
      "Use write_overseer_note after approved tasks to keep local progress timeline current.",
    ],
  };
}
