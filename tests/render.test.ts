import { describe, it, expect } from "vitest";
import { HandoffInput, type Effort, type ExecutionMode } from "../src/schema.js";
import { renderCodexTarget } from "../src/render/codex.js";
import { renderClaudeTarget } from "../src/render/claude.js";
import { buildPromptPrefix, toRenderable } from "../src/render/shared.js";
import { sampleInput, sampleInputArray } from "./_helpers.js";

const EFFORTS: Effort[] = ["max", "xhigh", "high", "medium", "low"];
const MODES: ExecutionMode[] = ["read_only", "plan", "patch", "test", "review"];

describe("renderCodexTarget", () => {
  it("emits expected flags for the 5x5 effort×execution_mode matrix", () => {
    for (const effort of EFFORTS) {
      for (const mode of MODES) {
        const input = HandoffInput.parse(
          sampleInput({ target_agent: "codex", effort, execution_mode: mode }),
        );
        const r = renderCodexTarget(input);
        expect(r.suggested_argv[0]).toBe("codex");
        expect(r.suggested_argv[1]).toBe("exec");
        expect(r.suggested_argv).toContain(`model_reasoning_effort=${effort}`);
        const sandbox = ["patch", "test"].includes(mode) ? "workspace-write" : "read-only";
        const sIdx = r.suggested_argv.indexOf("--sandbox");
        expect(sIdx).toBeGreaterThan(-1);
        expect(r.suggested_argv[sIdx + 1]).toBe(sandbox);
        expect(r.suggested_argv).toContain("--skip-git-repo-check");
      }
    }
  });

  it("emits advisory_only note when allowed/forbidden files are present", () => {
    const input = HandoffInput.parse(sampleInput({ target_agent: "codex" }));
    const r = renderCodexTarget(input);
    expect(r.advisory_notes.join(" ")).toMatch(/no native per-file allowlist/);
  });

  it("includes --cd when working_dir is set", () => {
    const input = HandoffInput.parse(
      sampleInput({ target_agent: "codex", working_dir: "/tmp/work" }),
    );
    const r = renderCodexTarget(input);
    const i = r.suggested_argv.indexOf("--cd");
    expect(i).toBeGreaterThan(-1);
    expect(r.suggested_argv[i + 1]).toBe("/tmp/work");
  });

  it("includes RelayOS overseer MCP bootstrap reminder in prompt", () => {
    const input = HandoffInput.parse(sampleInput({ target_agent: "codex" }));
    const r = renderCodexTarget(input);
    expect(r.prompt).toContain("RelayOS Overseer MCP bootstrap");
    expect(r.prompt).toContain("read_overseer_bootstrap_prompt");
    expect(r.prompt).toContain("read_overseer_handshake");
    expect(r.prompt).toContain("read_overseer_context_pack");
    expect(r.prompt).toContain("read_overseer_recent");
    expect(r.prompt).toContain("before execution");
    expect(r.prompt).toContain("Do not edit files");
  });
});

describe("renderClaudeTarget", () => {
  it("emits expected permission-mode for every execution_mode", () => {
    for (const mode of MODES) {
      const input = HandoffInput.parse(
        sampleInput({ target_agent: "claude", model: "claude-opus-4-7", execution_mode: mode }),
      );
      const r = renderClaudeTarget(input);
      const i = r.suggested_argv.indexOf("--permission-mode");
      expect(i).toBeGreaterThan(-1);
      const expected =
        mode === "patch" || mode === "test" ? "acceptEdits" : "plan";
      expect(r.suggested_argv[i + 1]).toBe(expected);
    }
  });

  it("adds --allowed-tools restriction for read_only", () => {
    const input = HandoffInput.parse(
      sampleInput({
        target_agent: "claude",
        model: "claude-opus-4-7",
        execution_mode: "read_only",
      }),
    );
    const r = renderClaudeTarget(input);
    expect(r.suggested_argv.indexOf("--allowed-tools")).toBeGreaterThan(-1);
  });

  it("always notes effort is advisory-only on claude", () => {
    const input = HandoffInput.parse(
      sampleInput({ target_agent: "claude", model: "claude-opus-4-7" }),
    );
    const r = renderClaudeTarget(input);
    expect(r.advisory_notes.join(" ")).toMatch(/no native effort flag/);
  });

  it("includes RelayOS overseer MCP bootstrap reminder in prompt", () => {
    const input = HandoffInput.parse(
      sampleInput({ target_agent: "claude", model: "claude-opus-4-7" }),
    );
    const r = renderClaudeTarget(input);
    expect(r.prompt).toContain("RelayOS Overseer MCP bootstrap");
    expect(r.prompt).toContain("read_overseer_bootstrap_prompt");
    expect(r.prompt).toContain("read_overseer_handshake");
    expect(r.prompt).toContain("read_overseer_context_pack");
    expect(r.prompt).toContain("read_overseer_recent");
    expect(r.prompt).toContain("before execution");
    expect(r.prompt).toContain("Do not edit files");
  });
});

describe("buildPromptPrefix", () => {
  it("omits Allowed-files section when empty", () => {
    const input = HandoffInput.parse(sampleInput({ allowed_files: [] }));
    const prefix = buildPromptPrefix(toRenderable(input));
    expect(prefix).not.toMatch(/Allowed files/);
  });

  it("renders Forbidden-files `(none)` when empty", () => {
    const input = HandoffInput.parse(sampleInput({ forbidden_files: [] }));
    const prefix = buildPromptPrefix(toRenderable(input));
    expect(prefix).toMatch(/Forbidden files .*\n  \(none\)/s);
  });

  it("renders constraints when present and omits when empty", () => {
    const withC = buildPromptPrefix(
      toRenderable(HandoffInput.parse(sampleInput({ constraints: ["No new deps"] }))),
    );
    expect(withC).toMatch(/Constraints:\n  - No new deps/);
    const withoutC = buildPromptPrefix(
      toRenderable(HandoffInput.parse(sampleInput({ constraints: [] }))),
    );
    expect(withoutC).not.toMatch(/Constraints:/);
  });

  it("includes the handoff id when given an envelope-shaped object", () => {
    const env = { ...HandoffInput.parse(sampleInput()), id: "h_TEST" };
    const prefix = buildPromptPrefix(toRenderable(env as never));
    expect(prefix).toMatch(/\[HANDOFF h_TEST/);
  });

  it("renders multiple expected outputs as bullets", () => {
    const input = HandoffInput.parse(sampleInputArray());
    const prefix = buildPromptPrefix(toRenderable(input));
    expect(prefix).toMatch(/Expected output:\n  - A unified diff\.\n  - A one-paragraph summary\./);
  });

  it("keeps single expected output rendering stable for string and array input", () => {
    const expected = "A unified diff plus a short summary.";
    const fromString = buildPromptPrefix(
      toRenderable(HandoffInput.parse(sampleInput({ expected_output: expected }))),
    );
    const fromArray = buildPromptPrefix(
      toRenderable(HandoffInput.parse(sampleInput({ expected_output: [expected] }))),
    );
    expect(fromArray).toBe(fromString);
    expect(fromString).toMatch(/Expected output:\nA unified diff plus a short summary\.\n\n---/);
  });
});
