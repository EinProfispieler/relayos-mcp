import { describe, it, expect } from "vitest";
import { HandoffInput } from "../src/schema.js";
import { sampleInput } from "./_helpers.js";

describe("HandoffInput schema", () => {
  it("accepts a complete valid input and applies defaults", () => {
    const parsed = HandoffInput.parse(sampleInput());
    expect(parsed.source_agent).toBe("claude");
    expect(parsed.target_agent).toBe("codex");
    expect(parsed.auto_spawn).toBe(false);
    expect(parsed.allowed_files).toEqual(["src/api/util/**/*.ts", "tests/api/util/**"]);
  });

  it("accepts empty constraints / allowed_files / forbidden_files", () => {
    const parsed = HandoffInput.parse(
      sampleInput({ allowed_files: [], forbidden_files: [], constraints: [] }),
    );
    expect(parsed.allowed_files).toEqual([]);
    expect(parsed.forbidden_files).toEqual([]);
    expect(parsed.constraints).toEqual([]);
  });

  it("rejects unknown source_agent", () => {
    const r = HandoffInput.safeParse(sampleInput({ source_agent: "gemini" }));
    expect(r.success).toBe(false);
  });

  it("rejects unknown target_agent", () => {
    const r = HandoffInput.safeParse(sampleInput({ target_agent: "cursor" }));
    expect(r.success).toBe(false);
  });

  it("rejects unknown effort", () => {
    const r = HandoffInput.safeParse(sampleInput({ effort: "ludicrous" }));
    expect(r.success).toBe(false);
  });

  it("rejects unknown execution_mode", () => {
    const r = HandoffInput.safeParse(sampleInput({ execution_mode: "deploy" }));
    expect(r.success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const { task_description: _td, ...incomplete } = sampleInput();
    const r = HandoffInput.safeParse(incomplete);
    expect(r.success).toBe(false);
  });

  it("rejects empty model / task_title / task_description / expected_output", () => {
    for (const k of ["model", "task_title", "task_description", "expected_output"]) {
      const r = HandoffInput.safeParse(sampleInput({ [k]: "" }));
      expect(r.success, `expected ${k}: "" to be rejected`).toBe(false);
    }
  });
});
