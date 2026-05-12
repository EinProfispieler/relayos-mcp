import { describe, it, expect, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import { createAuditWriter } from "../src/audit.js";
import { tempLayout } from "./_helpers.js";

describe("audit", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
  });

  it("append writes parseable JSONL lines", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const writer = createAuditWriter(layout);
    await writer.append("h_one", "created", { foo: 1 });
    await writer.append("h_two", "spawn_started", { argv: ["codex"] });
    const raw = await readFile(layout.auditPath, "utf8");
    const lines = raw.trim().split("\n");
    expect(lines.length).toBe(2);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("readByHandoffId filters to matching id", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const writer = createAuditWriter(layout);
    await writer.append("h_one", "created");
    await writer.append("h_two", "created");
    await writer.append("h_one", "validated");
    const oneEvents = await writer.readByHandoffId("h_one");
    expect(oneEvents.length).toBe(2);
    expect(oneEvents.every((e) => e.handoff_id === "h_one")).toBe(true);
  });

  it("readAll handles missing file as empty", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const writer = createAuditWriter(layout);
    const events = await writer.readAll();
    expect(events).toEqual([]);
  });

  it("each append writes exactly one newline-terminated line", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const writer = createAuditWriter(layout);
    await Promise.all([
      writer.append("h_x", "created"),
      writer.append("h_x", "validated"),
      writer.append("h_x", "rendered_codex_prompt"),
    ]);
    const raw = await readFile(layout.auditPath, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    const lines = raw.split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(3);
    for (const l of lines) {
      expect(() => JSON.parse(l)).not.toThrow();
    }
  });
});
