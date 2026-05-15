import { z } from "zod";
import { readLatestHandoffResults, resolveOverseerLayout } from "../overseer.js";

export const ReadHandoffResultsInput = z
  .object({
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict();
export type ReadHandoffResultsInput = z.infer<typeof ReadHandoffResultsInput>;

export interface HandoffResultRecord {
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

export interface ReadHandoffResultsResult {
  ok: true;
  workspace_path: string;
  results: HandoffResultRecord[];
  results_count: number;
  limit: number;
}

export async function readHandoffResults(
  rawInput: unknown,
): Promise<ReadHandoffResultsResult> {
  const input = ReadHandoffResultsInput.parse(rawInput ?? {});
  const limit = input.limit ?? 8;
  const layout = resolveOverseerLayout(process.cwd());
  const results = await readLatestHandoffResults(layout, limit);
  return {
    ok: true,
    workspace_path: layout.dir,
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
    limit,
  };
}
