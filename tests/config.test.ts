import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjectConfig } from "../src/config.js";

let workDirs: string[] = [];

function makeDir(): string {
  const d = mkdtempSync(join(tmpdir(), "relayos-cfg-"));
  workDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of workDirs) rmSync(d, { recursive: true, force: true });
  workDirs = [];
});

describe("loadProjectConfig", () => {
  it("returns empty config and null source when nothing is found", () => {
    const cwd = makeDir();
    const r = loadProjectConfig({ cwd, env: {} });
    expect(r.source).toBeNull();
    expect(r.config.templates).toEqual({});
  });

  it("loads a valid config at cwd/.relayos/config.json", () => {
    const cwd = makeDir();
    mkdirSync(join(cwd, ".relayos"));
    writeFileSync(
      join(cwd, ".relayos/config.json"),
      JSON.stringify({
        version: 1,
        defaults: { forbidden_files: ["**/dist/**"] },
        templates: { "codex-patch": { effort: "max" } },
      }),
    );
    const r = loadProjectConfig({ cwd, env: {} });
    expect(r.source).toBe(join(cwd, ".relayos/config.json"));
    expect(r.config.templates["codex-patch"]?.effort).toBe("max");
  });

  it("walks upward to find a config in a parent directory", () => {
    const root = makeDir();
    mkdirSync(join(root, ".relayos"));
    writeFileSync(
      join(root, ".relayos/config.json"),
      JSON.stringify({ templates: { x: { effort: "low" } } }),
    );
    const nested = join(root, "a/b/c");
    mkdirSync(nested, { recursive: true });
    const r = loadProjectConfig({ cwd: nested, env: {} });
    expect(r.source).toBe(join(root, ".relayos/config.json"));
  });

  it("RELAYOS_CONFIG env var takes precedence", () => {
    const cwd = makeDir();
    mkdirSync(join(cwd, ".relayos"));
    writeFileSync(
      join(cwd, ".relayos/config.json"),
      JSON.stringify({ templates: { cwd: { effort: "low" } } }),
    );
    const other = makeDir();
    const otherPath = join(other, "explicit.json");
    writeFileSync(otherPath, JSON.stringify({ templates: { env: { effort: "max" } } }));
    const r = loadProjectConfig({ cwd, env: { RELAYOS_CONFIG: otherPath } });
    expect(r.source).toBe(otherPath);
    expect(r.config.templates.env?.effort).toBe("max");
    expect(r.config.templates.cwd).toBeUndefined();
  });

  it("throws on malformed JSON with path in message", () => {
    const cwd = makeDir();
    mkdirSync(join(cwd, ".relayos"));
    writeFileSync(join(cwd, ".relayos/config.json"), "{not json");
    expect(() => loadProjectConfig({ cwd, env: {} })).toThrow(/config\.json/);
  });

  it("throws on schema violation listing issues", () => {
    const cwd = makeDir();
    mkdirSync(join(cwd, ".relayos"));
    writeFileSync(
      join(cwd, ".relayos/config.json"),
      JSON.stringify({ extra_key_not_allowed: true }),
    );
    expect(() => loadProjectConfig({ cwd, env: {} })).toThrow(/Unrecognized key|invalid/i);
  });
});
