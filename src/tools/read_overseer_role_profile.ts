import { z } from "zod";
import {
  buildOverseerRoleProfile,
  type OverseerRoleProfile,
} from "../overseer.js";

export const ReadOverseerRoleProfileInput = z.object({}).strict();
export type ReadOverseerRoleProfileInput = z.infer<
  typeof ReadOverseerRoleProfileInput
>;

export type ReadOverseerRoleProfileResult = OverseerRoleProfile;

export async function readOverseerRoleProfile(
  rawInput: unknown,
): Promise<ReadOverseerRoleProfileResult> {
  ReadOverseerRoleProfileInput.parse(rawInput ?? {});
  return buildOverseerRoleProfile();
}
