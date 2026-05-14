import { z } from "zod";
import { buildOverseerContextPack, type OverseerContextPack } from "../overseer.js";

export const ReadOverseerContextPackInput = z
  .object({
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict();
export type ReadOverseerContextPackInput = z.infer<
  typeof ReadOverseerContextPackInput
>;

export type ReadOverseerContextPackResult = OverseerContextPack;

export async function readOverseerContextPack(
  rawInput: unknown,
): Promise<ReadOverseerContextPackResult> {
  const input = ReadOverseerContextPackInput.parse(rawInput ?? {});
  const limit = input.limit ?? 8;
  return buildOverseerContextPack(process.cwd(), limit);
}
