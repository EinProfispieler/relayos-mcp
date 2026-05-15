import { z } from "zod";
import { appendDecision, resolveOverseerLayout } from "../overseer.js";

export const WriteOverseerDecisionInput = z
  .object({
    text: z.string().trim().min(1),
  })
  .strict();
export type WriteOverseerDecisionInput = z.infer<typeof WriteOverseerDecisionInput>;

export interface WriteOverseerDecisionResult {
  ok: true;
  recorded: string;
  decisions_path: string;
}

export async function writeOverseerDecision(
  rawInput: unknown,
): Promise<WriteOverseerDecisionResult> {
  const input = WriteOverseerDecisionInput.parse(rawInput ?? {});
  const layout = resolveOverseerLayout(process.cwd());
  await appendDecision(layout, input.text);
  return {
    ok: true,
    recorded: input.text,
    decisions_path: layout.decisionsPath,
  };
}
