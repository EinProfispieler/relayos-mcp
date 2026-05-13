import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { doctor } from "../src/tools/doctor.js";
import { createAuditWriter } from "../src/audit.js";
import { SERVER_VERSION } from "../src/version.js";
import { tempLayout } from "./_helpers.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

describe("doctor", () => {
  it("returns overall pass on a healthy temp layout", async () => {
    const { layout, cleanup } = await tempLayout();
    cleanups.push(cleanup);
    const audit = createAuditWriter(layout);
    const r = await doctor(
      { package_version: SERVER_VERSION },
      { layout, audit, cwd: layout.root, env: { HANDOFF_DIR: layout.root } },
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
      { layout, audit, cwd: layout.root, env: { HANDOFF_DIR: layout.root } },
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
      { layout, audit, cwd: layout.root, env: { HANDOFF_DIR: layout.root } },
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
      { layout, audit, cwd: layout.root, env: { HANDOFF_DIR: layout.root } },
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
      { layout, audit, cwd: layout.root, env: { HANDOFF_DIR: layout.root } },
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
      { layout, audit, cwd: layout.root, env: { HANDOFF_DIR: layout.root } },
    );
    const cl = r.checks.find((c) => c.name === "config_loadable")!;
    expect(cl.status).toBe("fail");
    expect(cl.detail?.error).toMatch(/malformed JSON/);
    const pt = r.checks.find((c) => c.name === "project_templates_valid")!;
    expect(pt.status).toBe("n/a");
    expect(r.status).toBe("fail");
  });
});
