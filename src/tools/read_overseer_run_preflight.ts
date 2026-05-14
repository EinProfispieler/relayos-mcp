import { z } from "zod";
import { buildOverseerRunPreflight } from "../overseer.js";

export const ReadOverseerRunPreflightInput = z.object({}).strict();
export type ReadOverseerRunPreflightInput = z.infer<
  typeof ReadOverseerRunPreflightInput
>;

export async function readOverseerRunPreflight(
  rawInput: unknown,
): Promise<Awaited<ReturnType<typeof buildOverseerRunPreflight>>> {
  ReadOverseerRunPreflightInput.parse(rawInput ?? {});
  return buildOverseerRunPreflight(process.cwd());
}
