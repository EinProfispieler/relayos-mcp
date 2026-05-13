import { describe, it, expect, afterEach } from "vitest";
import {
  createQuickHandoff,
  QuickHandoffNoTemplateError,
} from "../src/tools/create_quick_handoff.js";
import { readHandoff } from "../src/tools/read_handoff.js";
import { createAuditWriter } from "../src/audit.js";
import { tempLayout } from "./_helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

describe("create_quick_handoff", () => {
  it("defaults to codex-patch when target_agent=codex and mode is omitted", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const r = await createQuickHandoff(
      {
        target_agent: "codex",
        task: "Refactor src/api/util/format.ts to use template literals.",
      },
      { layout, audit, cwd: layout.root, env: {} },
    );
    expect(r.status).toBe("recorded");
    const read = await readHandoff(
      { handoff_id: r.handoff_id },
      { layout, audit },
    );
    expect(read.envelope.target_agent).toBe("codex");
    expect(read.envelope.execution_mode).toBe("patch");
    expect(read.envelope.model).toBe("gpt-5-codex");
    expect(read.envelope.audit_metadata.tags).toContain(
      "template:codex-patch",
    );
  });

  it("defaults to claude-plan when target_agent=claude and mode is omitted", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const r = await createQuickHandoff(
      {
        target_agent: "claude",
        task: "Plan the auth-middleware rewrite for compliance.",
      },
      { layout, audit, cwd: layout.root, env: {} },
    );
    const read = await readHandoff(
      { handoff_id: r.handoff_id },
      { layout, audit },
    );
    expect(read.envelope.target_agent).toBe("claude");
    expect(read.envelope.execution_mode).toBe("plan");
    expect(read.envelope.model).toBe("claude-opus-4-7");
    expect(read.envelope.audit_metadata.tags).toContain("template:claude-plan");
  });

  it("maps explicit modes to the matching codex template", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const cases: Array<{ mode: "patch" | "review" | "test" | "plan"; tag: string; em: string }> = [
      { mode: "patch", tag: "template:codex-patch", em: "patch" },
      { mode: "review", tag: "template:codex-review", em: "review" },
      { mode: "test", tag: "template:codex-test", em: "test" },
      { mode: "plan", tag: "template:codex-plan", em: "plan" },
    ];
    for (const c of cases) {
      const r = await createQuickHandoff(
        { target_agent: "codex", task: `Do ${c.mode} work.`, mode: c.mode },
        { layout, audit, cwd: layout.root, env: {} },
      );
      const read = await readHandoff(
        { handoff_id: r.handoff_id },
        { layout, audit },
      );
      expect(read.envelope.execution_mode).toBe(c.em);
      expect(read.envelope.audit_metadata.tags).toContain(c.tag);
    }
  });

  it("maps explicit modes to the matching claude template", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const cases: Array<{ mode: "review" | "plan"; tag: string; em: string }> = [
      { mode: "review", tag: "template:claude-review", em: "review" },
      { mode: "plan", tag: "template:claude-plan", em: "plan" },
    ];
    for (const c of cases) {
      const r = await createQuickHandoff(
        { target_agent: "claude", task: `Do ${c.mode} work.`, mode: c.mode },
        { layout, audit, cwd: layout.root, env: {} },
      );
      const read = await readHandoff(
        { handoff_id: r.handoff_id },
        { layout, audit },
      );
      expect(read.envelope.execution_mode).toBe(c.em);
      expect(read.envelope.audit_metadata.tags).toContain(c.tag);
    }
  });

  it("throws QuickHandoffNoTemplateError for claude+patch (no built-in)", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    await expect(
      createQuickHandoff(
        { target_agent: "claude", task: "x", mode: "patch" },
        { layout, audit, cwd: layout.root, env: {} },
      ),
    ).rejects.toBeInstanceOf(QuickHandoffNoTemplateError);
  });

  it("throws QuickHandoffNoTemplateError for claude+test (no built-in)", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    await expect(
      createQuickHandoff(
        { target_agent: "claude", task: "x", mode: "test" },
        { layout, audit, cwd: layout.root, env: {} },
      ),
    ).rejects.toBeInstanceOf(QuickHandoffNoTemplateError);
  });

  it("rejects unknown modes (e.g. read_only) at schema parse time", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    await expect(
      createQuickHandoff(
        { target_agent: "codex", task: "x", mode: "read_only" },
        { layout, audit, cwd: layout.root, env: {} },
      ),
    ).rejects.toThrow();
  });

  it("passes allowed_files / forbidden_files / constraints through as overrides", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const r = await createQuickHandoff(
      {
        target_agent: "codex",
        task: "Refactor format helpers.",
        allowed_files: ["src/api/util/**/*.ts", "tests/api/util/**"],
        forbidden_files: ["secrets/**"],
        constraints: ["No new dependencies", "Keep public API stable"],
      },
      { layout, audit, cwd: layout.root, env: {} },
    );
    const read = await readHandoff(
      { handoff_id: r.handoff_id },
      { layout, audit },
    );
    expect(read.envelope.allowed_files).toEqual([
      "src/api/util/**/*.ts",
      "tests/api/util/**",
    ]);
    expect(read.envelope.forbidden_files).toEqual(["secrets/**"]);
    expect(read.envelope.constraints).toEqual([
      "No new dependencies",
      "Keep public API stable",
    ]);
  });

  it("derives task_title from task when omitted", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const r = await createQuickHandoff(
      {
        target_agent: "codex",
        task: "Fix the broken validator.\n\nAdditional context follows.",
      },
      { layout, audit, cwd: layout.root, env: {} },
    );
    const read = await readHandoff(
      { handoff_id: r.handoff_id },
      { layout, audit },
    );
    expect(read.envelope.task_title).toBe("Fix the broken validator");
  });

  it("respects explicit task_title", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const r = await createQuickHandoff(
      {
        target_agent: "codex",
        task: "Do a long thing here.",
        task_title: "Short imperative title",
      },
      { layout, audit, cwd: layout.root, env: {} },
    );
    const read = await readHandoff(
      { handoff_id: r.handoff_id },
      { layout, audit },
    );
    expect(read.envelope.task_title).toBe("Short imperative title");
  });

  it("does not spawn when auto_spawn is omitted", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const r = await createQuickHandoff(
      { target_agent: "codex", task: "x" },
      { layout, audit, cwd: layout.root, env: {} },
    );
    expect(r.status).toBe("recorded");
    expect(r.spawn).toBeUndefined();
    const events = await audit.readByHandoffId(r.handoff_id);
    expect(events.some((e) => e.event === "spawn_started")).toBe(false);
  });

  it("rejects empty task", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    await expect(
      createQuickHandoff(
        { target_agent: "codex", task: "" },
        { layout, audit, cwd: layout.root, env: {} },
      ),
    ).rejects.toThrow();
  });
});
