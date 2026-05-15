import { z } from "zod";
import { buildOverseerDoctor, type OverseerDoctor } from "../overseer.js";

export const ReadOverseerDoctorInput = z.object({}).strict();
export type ReadOverseerDoctorInput = z.infer<typeof ReadOverseerDoctorInput>;

export type ReadOverseerDoctorResult = OverseerDoctor;

export async function readOverseerDoctor(
  rawInput: unknown,
): Promise<ReadOverseerDoctorResult> {
  ReadOverseerDoctorInput.parse(rawInput ?? {});
  return buildOverseerDoctor(process.cwd());
}
