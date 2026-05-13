import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inspectConfig } from "../src/tools/inspect_config.js";
import { tempLayout } from "./_helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

describe("inspect_config", () => {
  it("reports source=default when no config exists", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const r = inspectConfig(
      {},
      { cwd: layout.root, env: { HANDOFF_DIR: layout.root } },
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.config_source).toBe("default");
    expect(r.config_path).toBeNull();
    expect(r.templates.builtin.length).toBe(6);
    expect(r.templates.project).toEqual([]);
    expect(r.templates.shadowed).toEqual([]);
    expect(r.templates.total).toBe(6);
    expect(r.warnings).toEqual([]);
  });

  it("reports source=upward-search when .relayos/config.json is present", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const cfgDir = join(layout.root, ".relayos");
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({ templates: {} }),
      "utf8",
    );
    const r = inspectConfig(
      {},
      { cwd: layout.root, env: { HANDOFF_DIR: layout.root } },
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.config_source).toBe("upward-search");
    expect(r.config_path).toBe(join(cfgDir, "config.json"));
  });

  it("flags project templates that shadow built-ins", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const cfgDir = join(layout.root, ".relayos");
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({
        templates: {
          "codex-patch": { effort: "low" },
          "custom-thing": {
            target_agent: "codex",
            model: "x",
            effort: "low",
            execution_mode: "patch",
          },
        },
      }),
      "utf8",
    );
    const r = inspectConfig(
      {},
      { cwd: layout.root, env: { HANDOFF_DIR: layout.root } },
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.templates.shadowed).toContain("codex-patch");
    expect(r.templates.project).toContain("codex-patch");
    expect(r.templates.project).toContain("custom-thing");
    expect(r.warnings.some((w) => w.includes("codex-patch"))).toBe(true);
  });

  it("reports source=explicit-env when RELAYOS_CONFIG is set", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const explicitPath = join(layout.root, "explicit.json");
    writeFileSync(explicitPath, JSON.stringify({ templates: {} }), "utf8");
    const r = inspectConfig(
      {},
      {
        cwd: layout.root,
        env: { HANDOFF_DIR: layout.root, RELAYOS_CONFIG: explicitPath },
      },
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.config_source).toBe("explicit-env");
    expect(r.config_path).toBe(explicitPath);
  });

  it("returns structured error (no throw) for malformed JSON", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const cfgDir = join(layout.root, ".relayos");
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(join(cfgDir, "config.json"), "{ this is not json", "utf8");
    const r = inspectConfig(
      {},
      { cwd: layout.root, env: { HANDOFF_DIR: layout.root } },
    );
    expect(r.status).toBe("error");
    if (r.status !== "error") return;
    expect(r.error.type).toBe("malformed_config");
    expect(r.error.message).toContain("malformed JSON");
    expect(r.templates.builtin.length).toBe(6);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
