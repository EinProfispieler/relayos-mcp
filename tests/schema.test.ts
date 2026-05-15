import { describe, it, expect } from "vitest";
import { AIRoutingPlan, Envelope, HandoffInput } from "../src/schema.js";
import { sampleInput, sampleInputArray } from "./_helpers.js";

describe("HandoffInput schema", () => {
  it("accepts a complete valid input and applies defaults", () => {
    const parsed = HandoffInput.parse(sampleInput());
    expect(parsed.source_agent).toBe("claude");
    expect(parsed.target_agent).toBe("codex");
    expect(parsed.auto_spawn).toBe(false);
    expect(parsed.allowed_files).toEqual(["src/api/util/**/*.ts", "tests/api/util/**"]);
    expect(parsed.expected_output).toEqual([
      "A unified diff and a one-paragraph summary of the change.",
    ]);
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

  it("accepts expected_output as a non-empty string array", () => {
    const parsed = HandoffInput.parse(sampleInputArray());
    expect(parsed.expected_output).toEqual([
      "A unified diff.",
      "A one-paragraph summary.",
    ]);
  });

  it("rejects empty expected_output arrays and empty array entries", () => {
    expect(HandoffInput.safeParse(sampleInput({ expected_output: [] })).success).toBe(false);
    expect(
      HandoffInput.safeParse(sampleInput({ expected_output: ["A diff", ""] })).success,
    ).toBe(false);
  });

  it("loads legacy envelopes with expected_output as a string", () => {
    const input = HandoffInput.parse(sampleInput());
    const parsed = Envelope.parse({
      id: "h_LEGACY",
      created_at: "2026-05-13T00:00:00.000Z",
      updated_at: "2026-05-13T00:00:00.000Z",
      status: "recorded",
      source_agent: input.source_agent,
      target_agent: input.target_agent,
      model: input.model,
      effort: input.effort,
      execution_mode: input.execution_mode,
      task_title: input.task_title,
      task_description: input.task_description,
      allowed_files: input.allowed_files,
      forbidden_files: input.forbidden_files,
      constraints: input.constraints,
      expected_output: "Legacy single expected output.",
      auto_spawn: input.auto_spawn,
      launch_command: "codex exec '<prompt>'",
      audit_metadata: {
        tags: [],
        event_count: 0,
        last_event_ts: "2026-05-13T00:00:00.000Z",
        cli_detection: {
          target_binary: "codex",
          found: false,
        },
        enforcement_notes: [],
      },
    });
    expect(parsed.expected_output).toEqual(["Legacy single expected output."]);
  });
});

describe("AIRoutingPlan schema", () => {
  it("parses a fully valid AIRoutingPlan", () => {
    const parsed = AIRoutingPlan.parse({
      task_type: "implementation",
      target: "codex",
      model: "gpt-5.3-codex",
      effort: "medium",
      mode: "implementation",
      approval_required: false,
      confidence: 0.9,
      reason: "matched keyword: implement",
      next_action: "Proceed with local implementation flow.",
    });
    expect(parsed.target).toBe("codex");
    expect(parsed.confidence).toBe(0.9);
  });

  it("throws when a required field is missing", () => {
    expect(() =>
      AIRoutingPlan.parse({
        task_type: "implementation",
        target: "codex",
        model: "gpt-5.3-codex",
        effort: "medium",
        mode: "implementation",
        approval_required: false,
        confidence: 0.9,
        reason: "matched keyword: implement",
      }),
    ).toThrow();
  });

  it("throws when confidence is greater than 1", () => {
    expect(() =>
      AIRoutingPlan.parse({
        task_type: "implementation",
        target: "codex",
        model: "gpt-5.3-codex",
        effort: "medium",
        mode: "implementation",
        approval_required: false,
        confidence: 1.5,
        reason: "matched keyword: implement",
        next_action: "Proceed with local implementation flow.",
      }),
    ).toThrow();
  });
});
