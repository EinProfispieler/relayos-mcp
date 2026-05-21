/**
 * MCP tool: write_run_event
 *
 * Appends a `TaskLedgerEntry` to the active run's `task_ledger.jsonl`.
 * Errors if no run is active. Follows the same shape/style as the
 * other read/write overseer tools in this directory.
 */
import { z } from "zod";
import {
  appendTaskLedgerEntry,
  readActiveRunId,
  resolveRunLayout,
} from "../run_ledger.js";
import { TaskLedgerStatus, type TaskLedgerEntry } from "../schema.js";

export const WriteRunEventInput = z
  .object({
    seq: z.number().int().min(1),
    user_input: z.string().min(1),
    status: TaskLedgerStatus,
    handoff_id: z.string().optional(),
    target_agent: z.string().optional(),
    model: z.string().optional(),
    effort: z.string().optional(),
    mode: z.string().optional(),
    result_summary: z.string().max(200).optional(),
  })
  .strict();
export type WriteRunEventInput = z.infer<typeof WriteRunEventInput>;

export interface WriteRunEventResult {
  ok: true;
  run_id: string;
  seq: number;
  path: string;
}

export async function writeRunEvent(
  rawInput: unknown,
  cwd: string = process.cwd(),
): Promise<WriteRunEventResult> {
  const input = WriteRunEventInput.parse(rawInput);
  const runId = await readActiveRunId(cwd);
  if (!runId) {
    throw new Error(
      "No active run — start one with `overseer run start` before writing run events.",
    );
  }
  const now = new Date().toISOString();
  const entry: TaskLedgerEntry = {
    seq: input.seq,
    task_id: `t_${input.seq}`,
    run_id: runId,
    user_input: input.user_input,
    status: input.status,
    handoff_id: input.handoff_id,
    target_agent: input.target_agent,
    model: input.model,
    effort: input.effort,
    mode: input.mode,
    result_summary: input.result_summary,
    created_at: now,
    updated_at: now,
  };
  await appendTaskLedgerEntry(cwd, runId, entry);
  return {
    ok: true,
    run_id: runId,
    seq: input.seq,
    path: resolveRunLayout(cwd, runId).taskLedger,
  };
}
