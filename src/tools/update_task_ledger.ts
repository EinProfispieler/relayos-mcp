/**
 * MCP tool: update_task_ledger
 *
 * Appends a status-transition record for an existing `TaskLedgerEntry`.
 * The dedup-on-read in `readTaskLedgerEntries()` makes this the
 * effective update path: same `seq`, later `updated_at` wins.
 */
import { z } from "zod";
import {
  appendTaskLedgerEntry,
  readActiveRunId,
  readTaskLedgerEntries,
  resolveRunLayout,
} from "../run_ledger.js";
import { TaskLedgerStatus, type TaskLedgerEntry } from "../schema.js";

export const UpdateTaskLedgerInput = z
  .object({
    seq: z.number().int().min(1),
    status: TaskLedgerStatus.optional(),
    handoff_id: z.string().optional(),
    result_summary: z.string().max(200).optional(),
  })
  .strict();
export type UpdateTaskLedgerInput = z.infer<typeof UpdateTaskLedgerInput>;

export interface UpdateTaskLedgerResult {
  ok: true;
  run_id: string;
  seq: number;
  path: string;
}

export async function updateTaskLedger(
  rawInput: unknown,
  cwd: string = process.cwd(),
): Promise<UpdateTaskLedgerResult> {
  const input = UpdateTaskLedgerInput.parse(rawInput);
  const runId = await readActiveRunId(cwd);
  if (!runId) {
    throw new Error("No active run");
  }
  const allEntries = await readTaskLedgerEntries(cwd, runId, 1000);
  const existing = allEntries.find((e) => e.seq === input.seq);
  if (!existing) {
    throw new Error(`No task with seq ${input.seq} in run ${runId}`);
  }
  const updated: TaskLedgerEntry = {
    ...existing,
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.handoff_id !== undefined ? { handoff_id: input.handoff_id } : {}),
    ...(input.result_summary !== undefined
      ? { result_summary: input.result_summary }
      : {}),
    updated_at: new Date().toISOString(),
  };
  await appendTaskLedgerEntry(cwd, runId, updated);
  return {
    ok: true,
    run_id: runId,
    seq: input.seq,
    path: resolveRunLayout(cwd, runId).taskLedger,
  };
}
