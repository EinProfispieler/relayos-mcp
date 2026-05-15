import { z } from "zod";
import { readLatestDecisions, resolveOverseerLayout } from "../overseer.js";

export const ReadOverseerDecisionsInput = z
  .object({
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict();
export type ReadOverseerDecisionsInput = z.infer<typeof ReadOverseerDecisionsInput>;

export interface OverseerDecisionRecord {
  ts: string;
  text: string;
}

export interface ReadOverseerDecisionsResult {
  ok: true;
  workspace_path: string;
  decisions: OverseerDecisionRecord[];
  decisions_count: number;
  limit: number;
}

export async function readOverseerDecisions(
  rawInput: unknown,
): Promise<ReadOverseerDecisionsResult> {
  const input = ReadOverseerDecisionsInput.parse(rawInput ?? {});
  const limit = input.limit ?? 8;
  const layout = resolveOverseerLayout(process.cwd());
  const decisions = await readLatestDecisions(layout, limit);
  return {
    ok: true,
    workspace_path: layout.dir,
    decisions: decisions.map((d) => ({ ts: d.ts, text: d.text })),
    decisions_count: decisions.length,
    limit,
  };
}
