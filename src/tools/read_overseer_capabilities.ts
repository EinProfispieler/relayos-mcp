import { z } from "zod";
import { buildOverseerCapabilities, type OverseerCapabilities } from "../overseer.js";

export const ReadOverseerCapabilitiesInput = z.object({}).strict();
export type ReadOverseerCapabilitiesInput = z.infer<
  typeof ReadOverseerCapabilitiesInput
>;

export type ReadOverseerCapabilitiesResult = OverseerCapabilities;

export async function readOverseerCapabilities(
  rawInput: unknown,
): Promise<ReadOverseerCapabilitiesResult> {
  ReadOverseerCapabilitiesInput.parse(rawInput ?? {});
  return buildOverseerCapabilities(process.cwd());
}
