import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listTemplates } from "../src/tools/list_templates.js";

describe("list_templates tool", () => {
  it("returns six built-ins when there is no project config", () => {
    const cwd = mkdtempSync(join(tmpdir(), "relayos-lt-"));
    try {
      const r = listTemplates({}, { cwd, env: {} });
      expect(r.templates.length).toBe(6);
      expect(r.templates.every((t) => t.source === "builtin")).toBe(true);
      expect(r.config_source).toBeNull();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("includes project additions and reports config_source", () => {
    const cwd = mkdtempSync(join(tmpdir(), "relayos-lt-"));
    try {
      mkdirSync(join(cwd, ".relayos"));
      writeFileSync(
        join(cwd, ".relayos/config.json"),
        JSON.stringify({
          templates: {
            "internal-migration": {
              target_agent: "codex",
              model: "gpt-5-codex",
              effort: "high",
              execution_mode: "patch",
              expected_output: ["A scoped diff."],
            },
          },
        }),
      );
      const r = listTemplates({}, { cwd, env: {} });
      expect(r.templates.length).toBe(7);
      const im = r.templates.find((t) => t.name === "internal-migration");
      expect(im?.source).toBe("project");
      expect(r.config_source).toBe(join(cwd, ".relayos/config.json"));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("filters by target_agent", () => {
    const cwd = mkdtempSync(join(tmpdir(), "relayos-lt-"));
    try {
      const r = listTemplates({ target_agent: "claude" }, { cwd, env: {} });
      expect(r.templates.every((t) => t.target_agent === "claude")).toBe(true);
      expect(r.templates.length).toBe(2);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
