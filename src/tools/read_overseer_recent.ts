import { z } from "zod";
import {
  readLatestNotes,
  readNextAction,
  readOverseerContextSnapshot,
  readOverseerTextFile,
  resolveOverseerLayout,
} from "../overseer.js";

export const ReadOverseerRecentInput = z
  .object({
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict();
export type ReadOverseerRecentInput = z.infer<typeof ReadOverseerRecentInput>;

export interface OverseerRecentNote {
  ts: string;
  text: string;
}

export interface ReadOverseerRecentResult {
  ok: boolean;
  workspace_path: string;
  context_complete: boolean;
  missing: string[];
  next_action: string | null;
  current_state: string | null;
  recent_notes: OverseerRecentNote[];
  notes_count: number;
  limit: number;
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

export async function readOverseerRecent(
  rawInput: unknown,
): Promise<ReadOverseerRecentResult> {
  const input = ReadOverseerRecentInput.parse(rawInput ?? {});
  const limit = input.limit ?? 5;
  const cwd = process.cwd();
  const layout = resolveOverseerLayout(cwd);

  const [context, nextAction, currentStateRaw, notes] = await Promise.all([
    readOverseerContextSnapshot(cwd),
    readNextAction(layout),
    readOverseerTextFile(layout, "CURRENT_STATE.md"),
    readLatestNotes(layout, limit),
  ]);

  return {
    ok: context.ok,
    workspace_path: context.workspace_path,
    context_complete: context.ok,
    missing: context.missing,
    next_action: compactText(nextAction),
    current_state: compactText(currentStateRaw),
    recent_notes: notes.map((n) => ({ ts: n.ts, text: n.text })),
    notes_count: notes.length,
    limit,
  };
}
