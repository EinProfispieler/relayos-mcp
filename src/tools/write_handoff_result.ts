import { z } from "zod";
import {
  appendHandoffResult,
  type OverseerHandoffResultStatus,
  resolveOverseerLayout,
} from "../overseer.js";

export const WriteHandoffResultInput = z
  .object({
    run_id: z.string().trim().min(1),
    status: z.enum(["completed", "failed", "blocked", "needs_review"]),
    summary: z.string().trim().min(1),
    tests_run: z.array(z.string()).optional(),
    test_result: z.string().optional(),
    blockers: z.array(z.string()).optional(),
    needs_review: z.boolean().optional(),
    requires_user_approval: z.boolean().optional(),
  })
  .strict();
export type WriteHandoffResultInput = z.infer<typeof WriteHandoffResultInput>;

export interface WriteHandoffResultRecord {
  run_id: string;
  status: OverseerHandoffResultStatus;
  summary: string;
  tests_run?: string[];
  test_result?: string;
  blockers?: string[];
  needs_review?: boolean;
  requires_user_approval?: boolean;
}

export interface WriteHandoffResultResult {
  ok: true;
  recorded: WriteHandoffResultRecord;
  results_path: string;
}

export async function writeHandoffResult(
  rawInput: unknown,
): Promise<WriteHandoffResultResult> {
  const input = WriteHandoffResultInput.parse(rawInput ?? {});
  const layout = resolveOverseerLayout(process.cwd());
  await appendHandoffResult(layout, input);
  return {
    ok: true,
    recorded: {
      run_id: input.run_id,
      status: input.status,
      summary: input.summary,
      tests_run: input.tests_run,
      test_result: input.test_result,
      blockers: input.blockers,
      needs_review: input.needs_review,
      requires_user_approval: input.requires_user_approval,
    },
    results_path: layout.handoffResultsPath,
  };
}
