import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doctor } from "../src/tools/doctor.js";
import { createAuditWriter } from "../src/audit.js";
import { BUILTIN_TEMPLATES } from "../src/templates/builtin.js";
import { SERVER_VERSION } from "../src/version.js";
import { tempLayout } from "./_helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function freshRuntimeRoot() {
  const root = join(tmpdir(), `relayos-doctor-runtime-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(root, "src", "templates"), { recursive: true });
  mkdirSync(join(root, "src", "tools"), { recursive: true });
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "src", "templates", "builtin.ts"), "export {};\n", "utf8");
  writeFileSync(join(root, "src", "tools", "doctor.ts"), "export {};\n", "utf8");
  writeFileSync(join(root, "src", "index.ts"), "export {};\n", "utf8");
  writeFileSync(join(root, "dist", "index.js"), "export {};\n", "utf8");
  const srcTime = new Date("2026-01-01T00:00:00.000Z");
  const distTime = new Date("2026-01-02T00:00:00.000Z");
  for (const file of [
    join(root, "src", "templates", "builtin.ts"),
    join(root, "src", "tools", "doctor.ts"),
    join(root, "src", "index.ts"),
  ]) {
    utimesSync(file, srcTime, srcTime);
  }
  utimesSync(join(root, "dist", "index.js"), distTime, distTime);
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function staleRuntimeRoot() {
  const root = freshRuntimeRoot();
  const oldDistTime = new Date("2025-01-01T00:00:00.000Z");
  const newSrcTime = new Date("2026-01-01T00:00:00.000Z");
  utimesSync(join(root, "dist", "index.js"), oldDistTime, oldDistTime);
  utimesSync(join(root, "src", "templates", "builtin.ts"), newSrcTime, newSrcTime);
  return root;
}

const codexAvailable = async () => ({ onPath: true, version: "codex 1.2.3" });

type DoctorTestDeps = Parameters<typeof doctor>[1];

function depsFor(
  layout: DoctorTestDeps["layout"],
  audit: DoctorTestDeps["audit"],
  overrides: Partial<DoctorTestDeps> = {},
): DoctorTestDeps {
  return {
    layout,
    audit,
    cwd: layout.root,
    env: { HANDOFF_DIR: layout.root },
    codexProbe: codexAvailable,
    runtimeRoot: freshRuntimeRoot(),
    ...overrides,
  };
}

describe("doctor", () => {
  it("returns overall pass on a healthy temp layout", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const r = await doctor(
      { package_version: SERVER_VERSION },
      depsFor(layout, audit),
    );
    expect(r.status).toBe("pass");
    expect(r.server_version).toBe(SERVER_VERSION);
    const names = r.checks.map((c) => c.name);
    for (const n of [
      "config_loadable",
      "storage_path_available",
      "storage_listable",
      "storage_writable",
      "builtin_templates_loaded",
      "builtin_codex_template_models",
      "builtin_codex_model_compatibility",
      "codex_cli_available",
      "runtime_dist_fresh",
      "project_templates_valid",
      "list_handoffs_ok",
      "read_latest_handoff_shape_ok",
      "version_consistency",
    ]) {
      expect(names).toContain(n);
    }
    for (const c of r.checks) {
      expect(c.status).toBe("pass");
    }
  });

  it("warns when injected package_version differs from SERVER_VERSION", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const r = await doctor(
      { package_version: "9.9.9" },
      depsFor(layout, audit),
    );
    const vc = r.checks.find((c) => c.name === "version_consistency")!;
    expect(vc.status).toBe("warn");
    expect(vc.detail).toMatchObject({
      package_version: "9.9.9",
      server_version: SERVER_VERSION,
    });
    expect(r.status).toBe("warn");
  });

  it("warns instead of throwing when the storage directory is missing", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    rmSync(layout.root, { recursive: true, force: true });
    const audit = createAuditWriter(layout);
    const r = await doctor(
      { package_version: SERVER_VERSION },
      depsFor(layout, audit),
    );
    const spa = r.checks.find((c) => c.name === "storage_path_available")!;
    expect(spa.status).toBe("warn");
    const sw = r.checks.find((c) => c.name === "storage_writable")!;
    expect(sw.status).toBe("pass");
    expect(r.status).toBe("warn");
  });

  it("survives garbage envelope files (storage_listable still passes)", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    writeFileSync(join(layout.envelopesDir, "bogus.json"), "{not json", "utf8");
    const audit = createAuditWriter(layout);
    const r = await doctor(
      { package_version: SERVER_VERSION },
      depsFor(layout, audit),
    );
    const sl = r.checks.find((c) => c.name === "storage_listable")!;
    expect(sl.status).toBe("pass");
  });

  it("overall status is the worst of children", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const r = await doctor(
      { package_version: "different" },
      depsFor(layout, audit),
    );
    expect(r.status).toBe("warn");
  });

  it("malformed config causes config_loadable=fail and overall=fail (no throw)", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const cfgDir = join(layout.root, ".relayos");
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(join(cfgDir, "config.json"), "{ broken", "utf8");
    const audit = createAuditWriter(layout);
    const r = await doctor(
      { package_version: SERVER_VERSION },
      depsFor(layout, audit),
    );
    const cl = r.checks.find((c) => c.name === "config_loadable")!;
    expect(cl.status).toBe("fail");
    expect(cl.detail?.error).toMatch(/malformed JSON/);
    const pt = r.checks.find((c) => c.name === "project_templates_valid")!;
    expect(pt.status).toBe("n/a");
    expect(r.status).toBe("fail");
  });

  it("warns when the Codex CLI is missing", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const r = await doctor(
      { package_version: SERVER_VERSION },
      depsFor(layout, audit, {
        codexProbe: async () => ({ onPath: false, error: "spawn codex ENOENT" }),
      }),
    );
    const c = r.checks.find((check) => check.name === "codex_cli_available")!;
    expect(c.status).toBe("warn");
    expect(c.detail).toMatchObject({ on_path: false });
    expect(r.status).toBe("warn");
  });

  it("warns when Codex CLI version cannot be read", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const r = await doctor(
      { package_version: SERVER_VERSION },
      depsFor(layout, audit, {
        codexProbe: async () => ({ onPath: true, error: "timed out" }),
      }),
    );
    const c = r.checks.find((check) => check.name === "codex_cli_available")!;
    expect(c.status).toBe("warn");
    expect(c.message).toContain("codex --version");
    expect(c.detail).toMatchObject({ on_path: true, error: "timed out" });
    expect(r.status).toBe("warn");
  });

  it("warns when a built-in Codex template defaults to gpt-5-codex", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const codexPatch = BUILTIN_TEMPLATES["codex-patch"]!;
    const originalModel = codexPatch.model;
    codexPatch.model = "gpt-5-codex";
    cleanups.push(() => {
      codexPatch.model = originalModel;
    });

    const r = await doctor(
      { package_version: SERVER_VERSION },
      depsFor(layout, audit),
    );
    const c = r.checks.find((check) => check.name === "builtin_codex_model_compatibility")!;
    expect(c.status).toBe("warn");
    expect(c.message).toContain("codex-patch");
    expect(c.detail).toMatchObject({ templates: ["codex-patch"] });
    expect(r.status).toBe("warn");
  });

  it("warns when dist is older than relevant src files", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const r = await doctor(
      { package_version: SERVER_VERSION },
      depsFor(layout, audit, {
        runtimeRoot: staleRuntimeRoot(),
      }),
    );
    const c = r.checks.find((check) => check.name === "runtime_dist_fresh")!;
    expect(c.status).toBe("warn");
    expect(c.message).toContain("npm run build");
    expect(c.message).toContain("restart Claude/MCP");
    expect(c.detail?.stale_sources).toContain("src/templates/builtin.ts");
    expect(r.status).toBe("warn");
  });
});
