import { z } from "zod";
import { buildOverseerMemoryIndex, type OverseerMemoryIndex } from "../overseer.js";

export const ReadOverseerMemoryIndexInput = z
  .object({
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict();
export type ReadOverseerMemoryIndexInput = z.infer<typeof ReadOverseerMemoryIndexInput>;

export type ReadOverseerMemoryIndexResult = OverseerMemoryIndex;

export async function readOverseerMemoryIndex(
  rawInput: unknown,
): Promise<ReadOverseerMemoryIndexResult> {
  const input = ReadOverseerMemoryIndexInput.parse(rawInput ?? {});
  return buildOverseerMemoryIndex(process.cwd(), input.limit ?? 8);
}
