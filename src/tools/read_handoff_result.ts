import { z } from "zod";
import { readHandoffResultsByRunId, resolveOverseerLayout } from "../overseer.js";

export const ReadHandoffResultInput = z
  .object({
    run_id: z.string().trim().min(1),
  })
  .strict();
export type ReadHandoffResultInput = z.infer<typeof ReadHandoffResultInput>;

export interface HandoffResultByRunIdRecord {
  ts: string;
  run_id: string;
  status: "completed" | "failed" | "blocked" | "needs_review";
  summary: string;
  tests_run?: string[];
  test_result?: string;
  blockers?: string[];
  needs_review?: boolean;
  requires_user_approval?: boolean;
}

export interface ReadHandoffResultResult {
  ok: true;
  workspace_path: string;
  run_id: string;
  results: HandoffResultByRunIdRecord[];
  results_count: number;
}

export async function readHandoffResult(
  rawInput: unknown,
): Promise<ReadHandoffResultResult> {
  const input = ReadHandoffResultInput.parse(rawInput ?? {});
  const layout = resolveOverseerLayout(process.cwd());
  const results = await readHandoffResultsByRunId(layout, input.run_id);
  return {
    ok: true,
    workspace_path: layout.dir,
    run_id: input.run_id,
    results: results.map((r) => ({
      ts: r.ts,
      run_id: r.run_id,
      status: r.status,
      summary: r.summary,
      tests_run: r.tests_run,
      test_result: r.test_result,
      blockers: r.blockers,
      needs_review: r.needs_review,
      requires_user_approval: r.requires_user_approval,
    })),
    results_count: results.length,
  };
}
