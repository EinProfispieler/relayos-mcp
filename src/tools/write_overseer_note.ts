import { z } from "zod";
import { appendNote, resolveOverseerLayout } from "../overseer.js";

export const WriteOverseerNoteInput = z
  .object({
    text: z.string().trim().min(1),
  })
  .strict();
export type WriteOverseerNoteInput = z.infer<typeof WriteOverseerNoteInput>;

export interface WriteOverseerNoteResult {
  ok: true;
  recorded: string;
  timeline_path: string;
}

export async function writeOverseerNote(
  rawInput: unknown,
): Promise<WriteOverseerNoteResult> {
  const input = WriteOverseerNoteInput.parse(rawInput ?? {});
  const layout = resolveOverseerLayout(process.cwd());
  await appendNote(layout, input.text);
  return {
    ok: true,
    recorded: input.text,
    timeline_path: layout.timelinePath,
  };
}
