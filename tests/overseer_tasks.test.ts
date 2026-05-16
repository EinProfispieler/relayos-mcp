import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendTaskRecord,
  readRecentTasks,
  readTaskById,
  resolveOverseerLayout,
  updateTaskRecord,
} from "../src/overseer.js";
import type { TaskRecord } from "../src/schema.js";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "relayos-overseer-tasks-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  const now = "2026-05-16T00:00:00.000Z";
  return {
    task_id: "01TASK00000000000000000000",
    user_input: "Implement local task registry",
    route: {
      target: "codex",
      model: "gpt-5.3-codex",
      effort: "medium",
      mode: "patch",
      approval_required: false,
      reason: "matched implementation keyword",
    },
    ai_plan: {
      task_type: "implementation",
      target: "codex",
      model: "gpt-5.3-codex",
      effort: "medium",
      mode: "patch",
      approval_required: false,
      confidence: 0.91,
      reason: "matched implementation keyword",
      next_action: "Proceed with local implementation flow.",
    },
    action_proposal: {
      action: "create_handoff",
      target: "codex",
      model: "gpt-5.3-codex",
      effort: "medium",
      mode: "patch",
      approval_required: false,
      status: "not_executed",
    },
    status: "pending",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("overseer task registry", () => {
  it("appends and reads latest tasks", async () => {
    const cwd = tempDir();
    const layout = resolveOverseerLayout(cwd);
    const t1 = makeTask({ task_id: "01TASK00000000000000000001", user_input: "task 1" });
    const t2 = makeTask({ task_id: "01TASK00000000000000000002", user_input: "task 2" });

    await appendTaskRecord(layout, t1);
    await appendTaskRecord(layout, t2);

    const recent = await readRecentTasks(layout, 10);
    expect(recent).toHaveLength(2);
    expect(recent[0]?.task_id).toBe(t1.task_id);
    expect(recent[1]?.task_id).toBe(t2.task_id);
  });

  it("updates a task via append-only last-write-wins", async () => {
    const cwd = tempDir();
    const layout = resolveOverseerLayout(cwd);
    const taskId = "01TASK00000000000000000009";
    await appendTaskRecord(layout, makeTask({ task_id: taskId }));

    await updateTaskRecord(layout, taskId, {
      status: "completed",
      handoff_id: "h_01ABC",
      result_summary: "Handoff executed: h_01ABC",
      updated_at: "2026-05-16T00:01:00.000Z",
    });

    const latest = await readTaskById(layout, taskId);
    expect(latest).not.toBeNull();
    expect(latest?.status).toBe("completed");
    expect(latest?.handoff_id).toBe("h_01ABC");
    expect(latest?.result_summary).toBe("Handoff executed: h_01ABC");
    expect(latest?.created_at).toBe("2026-05-16T00:00:00.000Z");
  });

  it("deduplicates by task_id and returns latest unique records", async () => {
    const cwd = tempDir();
    const layout = resolveOverseerLayout(cwd);

    await appendTaskRecord(layout, makeTask({ task_id: "01TASK00000000000000000011", user_input: "old" }));
    await appendTaskRecord(layout, makeTask({ task_id: "01TASK00000000000000000012", user_input: "another" }));
    await appendTaskRecord(
      layout,
      makeTask({
        task_id: "01TASK00000000000000000011",
        user_input: "new",
        status: "approved",
        updated_at: "2026-05-16T00:02:00.000Z",
      }),
    );

    const recent = await readRecentTasks(layout, 10);
    expect(recent).toHaveLength(2);
    expect(recent[0]?.task_id).toBe("01TASK00000000000000000011");
    expect(recent[0]?.user_input).toBe("new");
    expect(recent[0]?.status).toBe("approved");
    expect(recent[1]?.task_id).toBe("01TASK00000000000000000012");
  });
});
