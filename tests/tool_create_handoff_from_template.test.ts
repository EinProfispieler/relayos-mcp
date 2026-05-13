import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHandoffFromTemplate } from "../src/tools/create_handoff_from_template.js";
import { readHandoff } from "../src/tools/read_handoff.js";
import { createAuditWriter } from "../src/audit.js";
import { tempLayout } from "./_helpers.js";
import { TemplateNotFoundError } from "../src/templates/resolve.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

describe("create_handoff_from_template", () => {
  it("creates a valid record-only handoff using codex-patch defaults", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const r = await createHandoffFromTemplate(
      {
        template: "codex-patch",
        task: "Fix validate_handoff payload handling and add a wrapped-input test.",
        overrides: { allowed_files: ["src/tools/validate_handoff.ts"] },
      },
      { layout, audit, cwd: layout.root, env: {} },
    );

    expect(r.status).toBe("recorded");
    expect(existsSync(r.envelope_path)).toBe(true);
    expect(r.launch_command).toMatch(/^codex exec /);
    expect(r.launch_command).toContain(r.handoff_id);

    const read = await readHandoff({ handoff_id: r.handoff_id }, { layout, audit });
    expect(read.envelope.target_agent).toBe("codex");
    expect(read.envelope.execution_mode).toBe("patch");
    expect(read.envelope.model).toBe("gpt-5.5");
    expect(read.envelope.effort).toBe("high");
    expect(read.envelope.allowed_files).toEqual(["src/tools/validate_handoff.ts"]);
    expect(read.envelope.expected_output).toEqual([
      "A unified diff.",
      "A one-paragraph summary of the change.",
    ]);
    expect(read.envelope.audit_metadata.tags).toContain("template:codex-patch");
  });

  it("derives task_title from task when omitted", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const r = await createHandoffFromTemplate(
      {
        template: "codex-patch",
        task: "Fix the broken validator.\n\nMore context follows on the next paragraph that should not become the title.",
      },
      { layout, audit, cwd: layout.root, env: {} },
    );
    const read = await readHandoff({ handoff_id: r.handoff_id }, { layout, audit });
    expect(read.envelope.task_title).toBe("Fix the broken validator");
    expect(read.envelope.task_title.length).toBeLessThanOrEqual(80);
  });

  it("truncates a long single-line task to 80 chars without trailing punctuation", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const longLine = "x".repeat(200);
    const r = await createHandoffFromTemplate(
      { template: "codex-patch", task: longLine },
      { layout, audit, cwd: layout.root, env: {} },
    );
    const read = await readHandoff({ handoff_id: r.handoff_id }, { layout, audit });
    expect(read.envelope.task_title.length).toBe(80);
    expect(read.envelope.task_title.endsWith(".")).toBe(false);
  });

  it("respects explicit task_title", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const r = await createHandoffFromTemplate(
      {
        template: "codex-patch",
        task: "Long task description.",
        task_title: "Short imperative title",
      },
      { layout, audit, cwd: layout.root, env: {} },
    );
    const read = await readHandoff({ handoff_id: r.handoff_id }, { layout, audit });
    expect(read.envelope.task_title).toBe("Short imperative title");
  });

  it("call-time overrides win over project config", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    mkdirSync(join(layout.root, ".relayos"));
    writeFileSync(
      join(layout.root, ".relayos/config.json"),
      JSON.stringify({
        templates: { "codex-patch": { effort: "low", allowed_files: ["from/project/**"] } },
      }),
    );
    const r = await createHandoffFromTemplate(
      {
        template: "codex-patch",
        task: "Do the thing.",
        overrides: { allowed_files: ["from/call/**"] },
      },
      { layout, audit, cwd: layout.root, env: {} },
    );
    const read = await readHandoff({ handoff_id: r.handoff_id }, { layout, audit });
    expect(read.envelope.effort).toBe("low");
    expect(read.envelope.allowed_files).toEqual(["from/call/**"]);
  });

  it("rejects an unknown template name", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    await expect(
      createHandoffFromTemplate(
        { template: "nope", task: "anything" },
        { layout, audit, cwd: layout.root, env: {} },
      ),
    ).rejects.toBeInstanceOf(TemplateNotFoundError);
  });

  it("rejects empty task", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    await expect(
      createHandoffFromTemplate(
        { template: "codex-patch", task: "" },
        { layout, audit, cwd: layout.root, env: {} },
      ),
    ).rejects.toThrow();
  });

  it("does not spawn when auto_spawn is omitted", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const r = await createHandoffFromTemplate(
      { template: "codex-patch", task: "x" },
      { layout, audit, cwd: layout.root, env: {} },
    );
    expect(r.status).toBe("recorded");
    expect(r.spawn).toBeUndefined();
    const events = await audit.readByHandoffId(r.handoff_id);
    expect(events.some((e) => e.event === "spawn_started")).toBe(false);
  });
});
