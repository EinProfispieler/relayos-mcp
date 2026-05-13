import { describe, it, expect } from "vitest";
import {
  Template,
  RelayConfig,
  CreateFromTemplateInput,
} from "../src/schema.js";

describe("Template schema", () => {
  it("parses a complete template", () => {
    const t = Template.parse({
      name: "codex-patch",
      description: "Codex code-patch handoff",
      target_agent: "codex",
      model: "gpt-5-codex",
      effort: "high",
      execution_mode: "patch",
      allowed_files: [],
      forbidden_files: [".env*"],
      constraints: [],
      expected_output: ["A unified diff.", "A summary."],
    });
    expect(t.name).toBe("codex-patch");
  });

  it("rejects unknown target_agent", () => {
    expect(
      Template.safeParse({
        name: "x",
        description: "x",
        target_agent: "gemini",
        model: "x",
        effort: "high",
        execution_mode: "patch",
        allowed_files: [],
        forbidden_files: [],
        constraints: [],
        expected_output: ["x"],
      }).success,
    ).toBe(false);
  });
});

describe("RelayConfig schema", () => {
  it("parses an empty config", () => {
    expect(RelayConfig.parse({}).templates).toEqual({});
  });

  it("parses defaults + per-template overrides", () => {
    const c = RelayConfig.parse({
      version: 1,
      defaults: { forbidden_files: ["**/dist/**"] },
      templates: { "codex-patch": { effort: "max" } },
    });
    expect(c.defaults?.forbidden_files).toEqual(["**/dist/**"]);
    expect(c.templates["codex-patch"]?.effort).toBe("max");
  });

  it("rejects unknown top-level keys (strict)", () => {
    expect(RelayConfig.safeParse({ extra: true }).success).toBe(false);
  });
});

describe("CreateFromTemplateInput schema", () => {
  it("requires template and task", () => {
    expect(
      CreateFromTemplateInput.safeParse({ template: "codex-patch", task: "fix it" })
        .success,
    ).toBe(true);
  });

  it("rejects empty task", () => {
    expect(
      CreateFromTemplateInput.safeParse({ template: "codex-patch", task: "" })
        .success,
    ).toBe(false);
  });

  it("accepts overrides subset", () => {
    const r = CreateFromTemplateInput.parse({
      template: "codex-patch",
      task: "fix it",
      overrides: { allowed_files: ["src/**"], effort: "max" },
    });
    expect(r.overrides?.allowed_files).toEqual(["src/**"]);
  });
});
