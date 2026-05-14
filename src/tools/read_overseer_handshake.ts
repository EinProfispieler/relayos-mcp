import { z } from "zod";
import { readOverseerHandshakeSnapshot } from "../overseer.js";

export const ReadOverseerHandshakeInput = z.object({}).strict();
export type ReadOverseerHandshakeInput = z.infer<typeof ReadOverseerHandshakeInput>;

export async function readOverseerHandshake(
  rawInput: unknown,
): Promise<Awaited<ReturnType<typeof readOverseerHandshakeSnapshot>>> {
  ReadOverseerHandshakeInput.parse(rawInput ?? {});
  return readOverseerHandshakeSnapshot(process.cwd());
}
