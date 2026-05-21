/**
 * MCP tool: read_current_run
 *
 * Returns the active run's record, last 10 deduplicated task ledger
 * entries, and the continuation packet (if any). Read-only.
 */
import { z } from "zod";
import {
  readActiveRunId,
  readContinuationPacket,
  readRunRecord,
  readTaskLedgerEntries,
} from "../run_ledger.js";
import type {
  ContinuationPacket,
  RunRecord,
  TaskLedgerEntry,
} from "../schema.js";

export const ReadCurrentRunInput = z.object({}).strict();
export type ReadCurrentRunInput = z.infer<typeof ReadCurrentRunInput>;

export interface ReadCurrentRunResult {
  run: RunRecord;
  recent_tasks: TaskLedgerEntry[];
  continuation: ContinuationPacket | null;
}

export async function readCurrentRun(
  rawInput: unknown,
  cwd: string = process.cwd(),
): Promise<ReadCurrentRunResult> {
  ReadCurrentRunInput.parse(rawInput ?? {});
  const runId = await readActiveRunId(cwd);
  if (!runId) {
    throw new Error("No active run");
  }
  const run = await readRunRecord(cwd, runId);
  if (!run) {
    throw new Error(`Run record missing for ${runId}`);
  }
  const recent_tasks = await readTaskLedgerEntries(cwd, runId, 10);
  const continuation = await readContinuationPacket(cwd, runId);
  return { run, recent_tasks, continuation };
}
