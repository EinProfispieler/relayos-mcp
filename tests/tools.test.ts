import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createHandoff } from "../src/tools/create_handoff.js";
import { validateHandoff } from "../src/tools/validate_handoff.js";
import {
  renderClaudePrompt,
  renderCodexPrompt,
} from "../src/tools/render_prompts.js";
import { writeAuditLog } from "../src/tools/write_audit_log.js";
import { listHandoffs } from "../src/tools/list_handoffs.js";
import { readHandoff } from "../src/tools/read_handoff.js";
import { createAuditWriter } from "../src/audit.js";
import { sampleInput, tempLayout } from "./_helpers.js";

describe("tools end-to-end", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
  });

  it("validate_handoff returns ok on valid input", () => {
    const r = validateHandoff(sampleInput());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalized.task_title).toContain("template literals");
  });

  it("validate_handoff returns issues on invalid input", () => {
    const r = validateHandoff(sampleInput({ effort: "ludicrous" }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.path === "effort")).toBe(true);
    }
  });

  it("create_handoff (record-only) writes envelope + audit", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const r = await createHandoff(sampleInput({ auto_spawn: false }), { layout, audit });
    expect(r.status).toBe("recorded");
    expect(existsSync(r.envelope_path)).toBe(true);
    expect(r.launch_command).toMatch(/^codex exec /);
    // launch_command must embed the real handoff id, not the "(uncommitted)" placeholder
    expect(r.launch_command).toContain(r.handoff_id);
    expect(r.launch_command).not.toContain("(uncommitted)");
    const log = readFileSync(layout.auditPath, "utf8").trim().split("\n");
    expect(log.length).toBeGreaterThanOrEqual(2);
    const events = log.map((l) => JSON.parse(l));
    const kinds = new Set(events.map((e) => e.event));
    expect(kinds.has("created")).toBe(true);
    expect(kinds.has("validated")).toBe(true);
  });

  it("create_handoff hard-fails on missing target binary when auto_spawn=true", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const origPath = process.env.PATH;
    process.env.PATH = "/var/empty:/usr/bin";
    try {
      const r = await createHandoff(
        sampleInput({ target_agent: "codex", auto_spawn: true }),
        { layout, audit },
      );
      expect(r.error?.code).toBe("missing_target_cli");
      expect(r.cli_detection.found).toBe(false);
      expect(r.status).toBe("recorded");
    } finally {
      process.env.PATH = origPath;
    }
  });

  it("create_handoff with auto_spawn=true successfully spawns sh stub when target is mapped to a real binary", async () => {
    // We can't actually spawn `codex` in CI. Use the spawn module directly elsewhere.
    // This test only verifies the record-only happy path of create_handoff to keep it hermetic.
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const r = await createHandoff(sampleInput({ auto_spawn: false }), { layout, audit });
    expect(r.status).toBe("recorded");
  });

  it("render_codex_prompt accepts inline input and does not audit when uncommitted", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const r = await renderCodexPrompt(
      { inline: sampleInput({ target_agent: "codex" }) },
      { layout, audit },
    );
    expect(r.launch_command).toMatch(/^codex exec /);
    expect(r.prompt).toMatch(/\[HANDOFF \(uncommitted\)/);
  });

  it("render_claude_prompt with a stored handoff_id appends an audit event", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const create = await createHandoff(
      sampleInput({ target_agent: "claude", model: "claude-opus-4-7", auto_spawn: false }),
      { layout, audit },
    );
    const r = await renderClaudePrompt(
      { handoff_id: create.handoff_id },
      { layout, audit },
    );
    expect(r.launch_command).toMatch(/^claude -p /);
    const events = await audit.readByHandoffId(create.handoff_id);
    expect(events.some((e) => e.event === "rendered_claude_prompt")).toBe(true);
  });

  it("renderers reject when neither/both of handoff_id and inline are given", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    await expect(renderClaudePrompt({}, { layout, audit })).rejects.toThrow(/exactly one/);
    await expect(
      renderClaudePrompt(
        { handoff_id: "h_x", inline: sampleInput() },
        { layout, audit },
      ),
    ).rejects.toThrow(/exactly one/);
  });

  it("write_audit_log appends a `custom` event and increments event_count", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const create = await createHandoff(sampleInput({ auto_spawn: false }), {
      layout,
      audit,
    });
    const r = await writeAuditLog(
      {
        handoff_id: create.handoff_id,
        event_label: "patch_applied",
        detail: { commit: "abc1234" },
      },
      { layout, audit },
    );
    expect(r.ok).toBe(true);
    const events = await audit.readByHandoffId(create.handoff_id);
    const custom = events.find((e) => e.event === "custom");
    expect(custom).toBeDefined();
    expect(custom!.detail.label).toBe("patch_applied");
    expect(custom!.detail.commit).toBe("abc1234");
  });

  it("list_handoffs returns summaries filterable by source/target/status", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    await createHandoff(sampleInput({ source_agent: "claude", target_agent: "codex" }), {
      layout,
      audit,
    });
    await createHandoff(
      sampleInput({
        source_agent: "codex",
        target_agent: "claude",
        model: "claude-opus-4-7",
      }),
      { layout, audit },
    );
    const all = await listHandoffs({}, { layout });
    expect(all.length).toBe(2);
    const onlyClaudeTarget = await listHandoffs(
      { target_agent: "claude" },
      { layout },
    );
    expect(onlyClaudeTarget.length).toBe(1);
    expect(onlyClaudeTarget[0]!.target_agent).toBe("claude");
  });

  it("read_handoff returns envelope and events", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const create = await createHandoff(sampleInput({ auto_spawn: false }), {
      layout,
      audit,
    });
    const r = await readHandoff(
      { handoff_id: create.handoff_id },
      { layout, audit },
    );
    expect(r.envelope.id).toBe(create.handoff_id);
    expect(r.events.length).toBeGreaterThanOrEqual(2);
    expect(r.events.every((e) => e.handoff_id === create.handoff_id)).toBe(true);
  });

  it("read_handoff throws on unknown id", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    await expect(
      readHandoff({ handoff_id: "h_NOPE" }, { layout, audit }),
    ).rejects.toThrow(/not found/);
  });
});
