/**
 * MCP tool: register_execution_workspace
 *
 * Records where work happened (git worktree / main checkout / external
 * checkout) and who owns it. Append-only — every call adds a new
 * `ExecutionWorkspace` record to the active run's `WORKSPACES.jsonl`.
 *
 * Errors if no run is active.
 */
import { z } from "zod";
import { newExecutionWorkspaceId } from "../id.js";
import {
  appendExecutionWorkspace,
  readActiveRunId,
} from "../run_ledger.js";
import {
  ExecutionWorkspaceCleanupPolicy,
  ExecutionWorkspaceKind,
  ExecutionWorkspaceOwner,
  type ExecutionWorkspace,
} from "../schema.js";

export const RegisterExecutionWorkspaceInput = z
  .object({
    kind: ExecutionWorkspaceKind,
    path: z.string().min(1),
    owner_agent: ExecutionWorkspaceOwner,
    branch: z.string().optional(),
    base_sha: z.string().optional(),
    head_sha: z.string().optional(),
    task_id: z.string().optional(),
    purpose: z.string().optional(),
    cleanup_policy: ExecutionWorkspaceCleanupPolicy.default("manual"),
    related_handoff_id: z.string().optional(),
  })
  .strict();
export type RegisterExecutionWorkspaceInput = z.infer<
  typeof RegisterExecutionWorkspaceInput
>;

export interface RegisterExecutionWorkspaceResult {
  ok: true;
  workspace_id: string;
  run_id: string;
  path: string;
}

export async function registerExecutionWorkspace(
  rawInput: unknown,
  cwd: string = process.cwd(),
): Promise<RegisterExecutionWorkspaceResult> {
  const input = RegisterExecutionWorkspaceInput.parse(rawInput);
  const runId = await readActiveRunId(cwd);
  if (!runId) {
    throw new Error(
      "No active run — start one with `overseer run start` before registering a workspace.",
    );
  }
  const id = newExecutionWorkspaceId();
  const now = new Date().toISOString();
  const ws: ExecutionWorkspace = {
    id,
    run_id: runId,
    kind: input.kind,
    path: input.path,
    owner_agent: input.owner_agent,
    branch: input.branch,
    base_sha: input.base_sha,
    head_sha: input.head_sha,
    task_id: input.task_id,
    purpose: input.purpose,
    status: "active",
    created_at: now,
    updated_at: now,
    cleanup_policy: input.cleanup_policy,
    related_handoff_id: input.related_handoff_id,
  };
  await appendExecutionWorkspace(cwd, runId, ws);
  return {
    ok: true,
    workspace_id: id,
    run_id: runId,
    path: input.path,
  };
}
