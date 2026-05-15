import { z } from "zod";
import { buildOverseerSummary, type OverseerSummary } from "../overseer.js";

export const ReadOverseerSummaryInput = z
  .object({
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict();
export type ReadOverseerSummaryInput = z.infer<typeof ReadOverseerSummaryInput>;

export type ReadOverseerSummaryResult = OverseerSummary;

export async function readOverseerSummary(
  rawInput: unknown,
): Promise<ReadOverseerSummaryResult> {
  const input = ReadOverseerSummaryInput.parse(rawInput ?? {});
  const limit = input.limit ?? 8;
  return buildOverseerSummary(process.cwd(), limit);
}
