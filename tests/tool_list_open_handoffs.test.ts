import { describe, it, expect, afterEach } from "vitest";
import { listOpenHandoffs } from "../src/tools/list_open_handoffs.js";
import { createHandoff } from "../src/tools/create_handoff.js";
import { createAuditWriter } from "../src/audit.js";
import {
  readEnvelope,
  writeEnvelope,
  applyStatus,
} from "../src/envelope.js";
import { tempLayout, sampleInput } from "./_helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

async function makeHandoff(
  layout: Parameters<typeof createHandoff>[1]["layout"],
  audit: ReturnType<typeof createAuditWriter>,
  overrides: Record<string, unknown> = {},
) {
  return createHandoff(sampleInput(overrides), { layout, audit });
}

describe("list_open_handoffs", () => {
  it("returns [] when no envelopes exist", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const r = await listOpenHandoffs({}, { layout });
    expect(r).toEqual([]);
  });

  it("returns only open envelopes (recorded + spawning)", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);

    const recorded = await makeHandoff(layout, audit, {
      task_title: "recorded one",
    });
    const spawning = await makeHandoff(layout, audit, {
      task_title: "spawning one",
    });
    const completed = await makeHandoff(layout, audit, {
      task_title: "completed one",
    });
    const failed = await makeHandoff(layout, audit, {
      task_title: "failed one",
    });

    for (const [id, status] of [
      [spawning.handoff_id, "spawning"] as const,
      [completed.handoff_id, "completed"] as const,
      [failed.handoff_id, "failed"] as const,
    ]) {
      const env = await readEnvelope(layout, id);
      expect(env).not.toBeNull();
      applyStatus(env!, status);
      await writeEnvelope(layout, env!);
    }

    const r = await listOpenHandoffs({}, { layout });
    const ids = r.map((s) => s.id).sort();
    expect(ids).toEqual([recorded.handoff_id, spawning.handoff_id].sort());
    for (const s of r) {
      expect(["recorded", "spawning"]).toContain(s.status);
    }
  });

  it("filters by assigned_to", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const codexH = await makeHandoff(layout, audit, {
      target_agent: "codex",
      task_title: "for codex",
    });
    const claudeH = await makeHandoff(layout, audit, {
      target_agent: "claude",
      model: "claude-opus-4-7",
      execution_mode: "plan",
      task_title: "for claude",
    });

    const codexOnly = await listOpenHandoffs(
      { assigned_to: "codex" },
      { layout },
    );
    expect(codexOnly.map((s) => s.id)).toEqual([codexH.handoff_id]);
    expect(codexOnly[0]!.assigned_to).toBe("codex");

    const claudeOnly = await listOpenHandoffs(
      { assigned_to: "claude" },
      { layout },
    );
    expect(claudeOnly.map((s) => s.id)).toEqual([claudeH.handoff_id]);
  });

  it("respects limit", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    for (let i = 0; i < 5; i++) {
      await makeHandoff(layout, audit, { task_title: `t${i}` });
    }
    const r = await listOpenHandoffs({ limit: 2 }, { layout });
    expect(r.length).toBe(2);
  });

  it("returns lightweight summary only — no full-envelope leak", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const h = await makeHandoff(layout, audit, {
      task_title: "summary check",
      audit_metadata: { tags: ["template:codex-patch", "extra"] },
    });
    const r = await listOpenHandoffs({}, { layout });
    expect(r.length).toBe(1);
    const s = r[0]!;
    expect(Object.keys(s).sort()).toEqual(
      [
        "id",
        "title",
        "assigned_to",
        "status",
        "created_at",
        "tags",
        "path",
      ].sort(),
    );
    const sAny = s as unknown as Record<string, unknown>;
    expect(sAny.task_description).toBeUndefined();
    expect(sAny.expected_output).toBeUndefined();
    expect(sAny.forbidden_files).toBeUndefined();
    expect(sAny.allowed_files).toBeUndefined();
    expect(sAny.constraints).toBeUndefined();
    expect(s.id).toBe(h.handoff_id);
    expect(s.title).toBe("summary check");
    expect(s.tags).toContain("template:codex-patch");
  });

  it("accepts arbitrary assigned_to string (e.g. 'cursor') without throwing", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    await makeHandoff(layout, audit);
    const r = await listOpenHandoffs(
      { assigned_to: "cursor" },
      { layout },
    );
    expect(r).toEqual([]);
  });
});
