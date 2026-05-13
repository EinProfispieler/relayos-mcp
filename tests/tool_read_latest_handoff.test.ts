import { describe, it, expect, afterEach } from "vitest";
import { createHandoff } from "../src/tools/create_handoff.js";
import { readLatestHandoff } from "../src/tools/read_latest_handoff.js";
import { createAuditWriter } from "../src/audit.js";
import {
  applyStatus,
  readEnvelope,
  writeEnvelope,
} from "../src/envelope.js";
import { tempLayout, sampleInputArray } from "./_helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("read_latest_handoff", () => {
  it("returns null envelope when nothing exists", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const r = await readLatestHandoff({}, { layout, audit });
    expect(r.envelope).toBeNull();
    expect(r.events).toEqual([]);
  });

  it("returns null when no envelope matches assigned_to", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    await createHandoff(sampleInputArray({ target_agent: "codex" }), {
      layout,
      audit,
    });
    const r = await readLatestHandoff(
      { assigned_to: "claude" },
      { layout, audit },
    );
    expect(r.envelope).toBeNull();
    expect(r.events).toEqual([]);
  });

  it("returns the most recent recorded envelope when no filter is set", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const a = await createHandoff(
      sampleInputArray({ task_title: "older" }),
      { layout, audit },
    );
    await sleep(5);
    const b = await createHandoff(
      sampleInputArray({ task_title: "newer" }),
      { layout, audit },
    );
    const r = await readLatestHandoff({}, { layout, audit });
    expect(r.envelope?.id).toBe(b.handoff_id);
    expect(r.envelope?.id).not.toBe(a.handoff_id);
    expect(r.envelope?.task_title).toBe("newer");
  });

  it("filters by assigned_to and skips non-matching newer envelopes", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const codex = await createHandoff(
      sampleInputArray({ target_agent: "codex", task_title: "for codex" }),
      { layout, audit },
    );
    await sleep(5);
    await createHandoff(
      sampleInputArray({
        target_agent: "claude",
        model: "claude-opus-4-7",
        task_title: "newer for claude",
      }),
      { layout, audit },
    );
    const r = await readLatestHandoff(
      { assigned_to: "codex" },
      { layout, audit },
    );
    expect(r.envelope?.id).toBe(codex.handoff_id);
    expect(r.envelope?.target_agent).toBe("codex");
  });

  it("excludes completed envelopes by default", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const a = await createHandoff(sampleInputArray({ task_title: "older" }), {
      layout,
      audit,
    });
    await sleep(5);
    const b = await createHandoff(sampleInputArray({ task_title: "newer" }), {
      layout,
      audit,
    });
    // Mark the newer one completed; the older one should be returned.
    const newer = await readEnvelope(layout, b.handoff_id);
    if (!newer) throw new Error("expected newer envelope");
    applyStatus(newer, "completed");
    await writeEnvelope(layout, newer);
    const r = await readLatestHandoff({}, { layout, audit });
    expect(r.envelope?.id).toBe(a.handoff_id);
  });

  it("includes spawning envelopes (treated as open)", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const created = await createHandoff(sampleInputArray({}), {
      layout,
      audit,
    });
    const env = await readEnvelope(layout, created.handoff_id);
    if (!env) throw new Error("expected envelope");
    applyStatus(env, "spawning");
    await writeEnvelope(layout, env);
    const r = await readLatestHandoff({}, { layout, audit });
    expect(r.envelope?.id).toBe(created.handoff_id);
    expect(r.envelope?.status).toBe("spawning");
  });

  it("returns the audit events for the chosen envelope", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const created = await createHandoff(sampleInputArray({}), {
      layout,
      audit,
    });
    const r = await readLatestHandoff(
      { assigned_to: "codex" },
      { layout, audit },
    );
    expect(r.envelope?.id).toBe(created.handoff_id);
    const kinds = r.events.map((e) => e.event);
    expect(kinds).toContain("created");
    expect(kinds).toContain("validated");
    expect(r.events.every((e) => e.handoff_id === created.handoff_id)).toBe(
      true,
    );
  });
});
