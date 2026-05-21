/**
 * MCP tool: read_current_task_ledger
 *
 * Returns the active run's task-ledger entries (deduplicated, last-N).
 * Read-only.
 */
import { z } from "zod";
import {
  readActiveRunId,
  readTaskLedgerEntries,
  resolveRunLayout,
} from "../run_ledger.js";
import type { TaskLedgerEntry } from "../schema.js";

export const ReadCurrentTaskLedgerInput = z
  .object({
    last_n: z.number().int().min(1).max(100).default(20),
  })
  .strict();
export type ReadCurrentTaskLedgerInput = z.infer<
  typeof ReadCurrentTaskLedgerInput
>;

export interface ReadCurrentTaskLedgerResult {
  run_id: string;
  entries: TaskLedgerEntry[];
  ledger_path: string;
}

export async function readCurrentTaskLedger(
  rawInput: unknown,
  cwd: string = process.cwd(),
): Promise<ReadCurrentTaskLedgerResult> {
  const input = ReadCurrentTaskLedgerInput.parse(rawInput ?? {});
  const runId = await readActiveRunId(cwd);
  if (!runId) {
    throw new Error("No active run");
  }
  const entries = await readTaskLedgerEntries(cwd, runId, input.last_n);
  return {
    run_id: runId,
    entries,
    ledger_path: resolveRunLayout(cwd, runId).taskLedger,
  };
}
