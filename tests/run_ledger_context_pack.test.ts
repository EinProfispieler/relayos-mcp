/**
 * Tests for Plan Task 7: `buildOverseerContextPack` surfaces the
 * active Run Ledger run as a compact `active_run` summary.
 *
 * The pack must:
 *   • set `active_run = null` when no run is active
 *   • populate `active_run` (id, goal, branch, task_count, recent
 *     summaries, continuation) when a run is active
 *   • NOT throw when the active pointer references a missing run
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildOverseerContextPack } from "../src/overseer.js";
import {
  appendTaskLedgerEntry,
  resolveActiveRunPath,
  setActiveRunId,
  writeContinuationPacket,
  writeRunRecord,
} from "../src/run_ledger.js";
import type { ContinuationPacket, RunRecord, TaskLedgerEntry } from "../src/schema.js";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "ctx-pack-run-"));
  // Minimal context so the pack doesn't choke (it's resilient to missing
  // canonical files but a present .relayos/overseer/ dir makes the path
  // more realistic).
  await mkdir(join(cwd, ".relayos", "overseer"), { recursive: true });
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

const RUN_ID = "r_01HXABCDEFGHJKMNPQRSTVWXYZ";

function isoNow(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: RUN_ID,
    status: "active",
    started_at: isoNow(),
    goal: "ship the run ledger CLI",
    branch: "feat/run-ledger-continuity",
    task_count: 2,
    handoff_ids: [],
    ...overrides,
  };
}

describe("buildOverseerContextPack — active_run", () => {
  it("active_run is null when no run is active", async () => {
    const pack = await buildOverseerContextPack(cwd, 5);
    expect(pack.active_run).toBeNull();
  });

  it("active_run is populated after run start (no compact yet)", async () => {
    await writeRunRecord(cwd, makeRun());
    await setActiveRunId(cwd, RUN_ID);

    const pack = await buildOverseerContextPack(cwd, 5);
    expect(pack.active_run).not.toBeNull();
    expect(pack.active_run!.run_id).toBe(RUN_ID);
    expect(pack.active_run!.status).toBe("active");
    expect(pack.active_run!.goal).toBe("ship the run ledger CLI");
    expect(pack.active_run!.branch).toBe("feat/run-ledger-continuity");
    expect(pack.active_run!.recent_task_summaries).toEqual([]);
    expect(pack.active_run!.continuation).toBeNull();
  });

  it("recent_task_summaries shows last-5 ledger entries (deduped by seq)", async () => {
    await writeRunRecord(cwd, makeRun());
    await setActiveRunId(cwd, RUN_ID);

    for (let i = 1; i <= 7; i++) {
      const entry: TaskLedgerEntry = {
        seq: i,
        task_id: `t_${i}`,
        run_id: RUN_ID,
        user_input: `task ${i} input`,
        status: "pending",
        created_at: isoNow(i),
        updated_at: isoNow(i),
      };
      await appendTaskLedgerEntry(cwd, RUN_ID, entry);
    }

    const pack = await buildOverseerContextPack(cwd, 5);
    const summaries = pack.active_run!.recent_task_summaries;
    expect(summaries.map((s) => s.seq)).toEqual([3, 4, 5, 6, 7]);
    expect(summaries[0]!.user_input).toBe("task 3 input");
  });

  it("continuation block is populated when a compact has happened", async () => {
    await writeRunRecord(cwd, makeRun());
    await setActiveRunId(cwd, RUN_ID);
    const packet: ContinuationPacket = {
      run_id: RUN_ID,
      generated_at: isoNow(),
      context_summary: "halfway through task 3",
      completed_task_ids: ["t_1", "t_2"],
      pending_task_ids: ["t_3"],
      last_handoff_id: "h_01HXYZ",
      last_handoff_status: "dispatched",
      open_questions: [],
      next_action: "review task 3 patch",
      files_modified: ["src/util.ts"],
      token_budget_note: "ok",
    };
    await writeContinuationPacket(cwd, RUN_ID, packet);

    const pack = await buildOverseerContextPack(cwd, 5);
    const c = pack.active_run!.continuation;
    expect(c).not.toBeNull();
    expect(c!.context_summary).toBe("halfway through task 3");
    expect(c!.next_action).toBe("review task 3 patch");
    expect(c!.completed_task_ids).toEqual(["t_1", "t_2"]);
    expect(c!.pending_task_ids).toEqual(["t_3"]);
    expect(c!.last_handoff_id).toBe("h_01HXYZ");
    expect(c!.last_handoff_status).toBe("dispatched");
    expect(c!.files_modified).toEqual(["src/util.ts"]);
  });

  it("does not throw when active pointer references a missing run record", async () => {
    // Write the pointer manually but never create the run.json
    await writeFile(
      resolveActiveRunPath(cwd),
      JSON.stringify({ run_id: "r_01MISSINGRUNIDXXXXXXXXXXXX" }),
      "utf8",
    );

    const pack = await buildOverseerContextPack(cwd, 5);
    // Defensive: pack still builds, active_run reads as null because
    // the pointed-at run record is missing.
    expect(pack.active_run).toBeNull();
  });

  it("truncates long user_input to 120 chars in summaries", async () => {
    await writeRunRecord(cwd, makeRun());
    await setActiveRunId(cwd, RUN_ID);
    const long = "x".repeat(500);
    await appendTaskLedgerEntry(cwd, RUN_ID, {
      seq: 1,
      task_id: "t_1",
      run_id: RUN_ID,
      user_input: long,
      status: "pending",
      created_at: isoNow(),
      updated_at: isoNow(),
    });
    const pack = await buildOverseerContextPack(cwd, 5);
    expect(pack.active_run!.recent_task_summaries[0]!.user_input).toHaveLength(
      120,
    );
  });
});
