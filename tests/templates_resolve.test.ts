import { describe, it, expect } from "vitest";
import {
  resolveTemplate,
  listAllTemplates,
  TemplateNotFoundError,
} from "../src/templates/resolve.js";
import { RelayConfig } from "../src/schema.js";

const EMPTY = RelayConfig.parse({});

describe("resolveTemplate", () => {
  it("returns built-in when no project config and no overrides", () => {
    const t = resolveTemplate("codex-patch", EMPTY);
    expect(t.target_agent).toBe("codex");
    expect(t.effort).toBe("high");
    expect(t.expected_output[0]).toContain("unified diff");
  });

  it("project defaults extend forbidden_files", () => {
    const cfg = RelayConfig.parse({
      defaults: { forbidden_files: ["**/dist/**"] },
    });
    const t = resolveTemplate("codex-patch", cfg);
    expect(t.forbidden_files).toContain("**/dist/**");
    expect(t.forbidden_files).toContain(".env*");
  });

  it("project per-template override beats built-in", () => {
    const cfg = RelayConfig.parse({
      templates: { "codex-patch": { effort: "max" } },
    });
    const t = resolveTemplate("codex-patch", cfg);
    expect(t.effort).toBe("max");
  });

  it("call-time overrides beat project config beat built-in", () => {
    const cfg = RelayConfig.parse({
      templates: { "codex-patch": { effort: "max", allowed_files: ["src/**"] } },
    });
    const t = resolveTemplate("codex-patch", cfg, {
      allowed_files: ["only/this/one.ts"],
    });
    expect(t.effort).toBe("max");
    expect(t.allowed_files).toEqual(["only/this/one.ts"]);
  });

  it("normalizes a string expected_output override into string[]", () => {
    const t = resolveTemplate("codex-patch", EMPTY, {
      expected_output: "Just one item.",
    });
    expect(t.expected_output).toEqual(["Just one item."]);
  });

  it("project config can add a new template not in built-ins", () => {
    const cfg = RelayConfig.parse({
      templates: {
        "internal-migration": {
          target_agent: "codex",
          model: "gpt-5.5",
          effort: "high",
          execution_mode: "patch",
          expected_output: ["A scoped diff.", "A rollback note."],
        },
      },
    });
    const t = resolveTemplate("internal-migration", cfg);
    expect(t.name).toBe("internal-migration");
    expect(t.expected_output).toEqual(["A scoped diff.", "A rollback note."]);
  });

  it("throws TemplateNotFoundError with available names", () => {
    try {
      resolveTemplate("nope", EMPTY);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(TemplateNotFoundError);
      const msg = (e as Error).message;
      expect(msg).toContain("nope");
      expect(msg).toContain("codex-patch");
    }
  });

  it("rejects user-defined templates missing required fields", () => {
    const cfg = RelayConfig.parse({
      templates: { broken: { effort: "high" } },
    });
    expect(() => resolveTemplate("broken", cfg)).toThrow();
  });

  it("resolving a built-in with no project config and no overrides never yields max or xhigh", () => {
    for (const name of [
      "codex-patch",
      "codex-review",
      "codex-test",
      "codex-plan",
      "claude-review",
      "claude-plan",
    ]) {
      const t = resolveTemplate(name, EMPTY);
      expect(["max", "xhigh"]).not.toContain(t.effort);
    }
  });

  it("call-time override is the only path to max", () => {
    const t = resolveTemplate("codex-patch", EMPTY, { effort: "max" });
    expect(t.effort).toBe("max");
  });
});

describe("listAllTemplates", () => {
  it("returns all six built-ins with source=builtin", () => {
    const list = listAllTemplates(EMPTY);
    expect(list.length).toBe(6);
    expect(list.every((t) => t.source === "builtin")).toBe(true);
  });

  it("includes project additions marked source=project", () => {
    const cfg = RelayConfig.parse({
      templates: {
        "internal-migration": {
          target_agent: "codex",
          model: "gpt-5.5",
          effort: "high",
          execution_mode: "patch",
          expected_output: ["A diff."],
        },
      },
    });
    const list = listAllTemplates(cfg);
    expect(list.length).toBe(7);
    expect(list.find((t) => t.name === "internal-migration")?.source).toBe("project");
  });

  it("marks built-ins overridden by project config as source=project", () => {
    const cfg = RelayConfig.parse({
      templates: { "codex-patch": { effort: "max" } },
    });
    const list = listAllTemplates(cfg);
    expect(list.find((t) => t.name === "codex-patch")?.source).toBe("project");
  });

  it("filters by target_agent", () => {
    const list = listAllTemplates(EMPTY, { target_agent: "claude" });
    expect(list.every((t) => t.target_agent === "claude")).toBe(true);
    expect(list.length).toBe(2);
  });
});
