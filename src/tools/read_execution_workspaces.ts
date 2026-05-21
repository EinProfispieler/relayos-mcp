/**
 * MCP tool: read_execution_workspaces
 *
 * Lists execution workspaces for a run (defaults to the active run).
 * Returns deduplicated workspaces (last-write-wins by id). Optionally
 * filters by status.
 */
import { z } from "zod";
import {
  readActiveRunId,
  readExecutionWorkspaces,
} from "../run_ledger.js";
import {
  ExecutionWorkspaceStatus,
  type ExecutionWorkspace,
} from "../schema.js";

export const ReadExecutionWorkspacesInput = z
  .object({
    run_id: z.string().optional(),
    status: ExecutionWorkspaceStatus.optional(),
  })
  .strict();
export type ReadExecutionWorkspacesInput = z.infer<
  typeof ReadExecutionWorkspacesInput
>;

export interface ReadExecutionWorkspacesResult {
  run_id: string;
  workspaces: ExecutionWorkspace[];
}

export async function readExecutionWorkspacesTool(
  rawInput: unknown,
  cwd: string = process.cwd(),
): Promise<ReadExecutionWorkspacesResult> {
  const input = ReadExecutionWorkspacesInput.parse(rawInput ?? {});
  const runId = input.run_id ?? (await readActiveRunId(cwd));
  if (!runId) {
    throw new Error("No active run (and no run_id supplied)");
  }
  const all = await readExecutionWorkspaces(cwd, runId);
  const filtered = input.status
    ? all.filter((w) => w.status === input.status)
    : all;
  return { run_id: runId, workspaces: filtered };
}
