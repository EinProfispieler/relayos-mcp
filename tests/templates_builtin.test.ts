import { describe, it, expect } from "vitest";
import { Template } from "../src/schema.js";
import { BUILTIN_TEMPLATES, BUILTIN_DEFAULTS } from "../src/templates/builtin.js";

describe("builtin templates", () => {
  it("exposes exactly six templates", () => {
    expect(Object.keys(BUILTIN_TEMPLATES).sort()).toEqual([
      "claude-plan",
      "claude-review",
      "codex-patch",
      "codex-plan",
      "codex-review",
      "codex-test",
    ]);
  });

  it("every template parses under the Template schema", () => {
    for (const t of Object.values(BUILTIN_TEMPLATES)) {
      const r = Template.safeParse(t);
      expect(r.success, `${t.name} failed: ${!r.success && JSON.stringify(r.error.issues)}`).toBe(true);
    }
  });

  it("codex-patch is the default patch target", () => {
    expect(BUILTIN_TEMPLATES["codex-patch"]!.target_agent).toBe("codex");
    expect(BUILTIN_TEMPLATES["codex-patch"]!.execution_mode).toBe("patch");
  });

  it("BUILTIN_DEFAULTS contains the floor forbidden_files", () => {
    expect(BUILTIN_DEFAULTS.forbidden_files).toEqual(
      expect.arrayContaining([".env*", "secrets/**", "**/node_modules/**"]),
    );
  });

  it("no built-in template defaults to max or xhigh (Core reliability-first invariant)", () => {
    for (const t of Object.values(BUILTIN_TEMPLATES)) {
      expect(
        ["max", "xhigh"].includes(t.effort),
        `${t.name} defaults to ${t.effort}; Core must not auto-select max/xhigh`,
      ).toBe(false);
    }
  });
});
