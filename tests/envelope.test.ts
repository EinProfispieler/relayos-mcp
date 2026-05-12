import { describe, it, expect, afterEach } from "vitest";
import {
  buildEnvelope,
  writeEnvelope,
  readEnvelope,
  applyStatus,
  bumpAuditCounter,
  listEnvelopes,
} from "../src/envelope.js";
import { HandoffInput } from "../src/schema.js";
import { sampleInput, tempLayout } from "./_helpers.js";

describe("envelope", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
  });

  it("buildEnvelope produces a valid envelope with status=recorded", () => {
    const input = HandoffInput.parse(sampleInput());
    const env = buildEnvelope(input, "codex exec ...");
    expect(env.id).toMatch(/^h_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(env.status).toBe("recorded");
    expect(env.audit_metadata.event_count).toBe(0);
    expect(env.audit_metadata.cli_detection.target_binary).toBe("codex");
    expect(env.audit_metadata.cli_detection.found).toBe(false);
  });

  it("write/read roundtrip preserves fields", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const input = HandoffInput.parse(sampleInput());
    const env = buildEnvelope(input, "codex exec ...");
    await writeEnvelope(layout, env);
    const back = await readEnvelope(layout, env.id);
    expect(back).not.toBeNull();
    expect(back!.id).toBe(env.id);
    expect(back!.task_title).toBe(env.task_title);
    expect(back!.allowed_files).toEqual(env.allowed_files);
  });

  it("applyStatus advances updated_at and changes status", async () => {
    const env = buildEnvelope(HandoffInput.parse(sampleInput()), "x");
    const before = env.updated_at;
    await new Promise((r) => setTimeout(r, 5));
    applyStatus(env, "spawning");
    expect(env.status).toBe("spawning");
    expect(env.updated_at >= before).toBe(true);
  });

  it("bumpAuditCounter increments event_count and updates last_event_ts", () => {
    const env = buildEnvelope(HandoffInput.parse(sampleInput()), "x");
    expect(env.audit_metadata.event_count).toBe(0);
    bumpAuditCounter(env, "2026-05-13T00:00:00.000Z");
    expect(env.audit_metadata.event_count).toBe(1);
    expect(env.audit_metadata.last_event_ts).toBe("2026-05-13T00:00:00.000Z");
  });

  it("listEnvelopes returns newest-first", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const a = buildEnvelope(HandoffInput.parse(sampleInput()), "x");
    await new Promise((r) => setTimeout(r, 5));
    const b = buildEnvelope(HandoffInput.parse(sampleInput()), "x");
    await writeEnvelope(layout, a);
    await writeEnvelope(layout, b);
    const list = await listEnvelopes(layout);
    expect(list[0]!.id).toBe(b.id);
    expect(list[1]!.id).toBe(a.id);
  });
});
