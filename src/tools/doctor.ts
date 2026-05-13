import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProjectConfig } from "../config.js";
import { BUILTIN_TEMPLATES } from "../templates/builtin.js";
import { listEnvelopes } from "../envelope.js";
import { listHandoffs } from "./list_handoffs.js";
import { readLatestHandoff } from "./read_latest_handoff.js";
import type { StorageLayout } from "../storage.js";
import type { AuditWriter } from "../audit.js";
import { SERVER_VERSION } from "../version.js";

export const DoctorInput = z
  .object({
    package_version: z.string().min(1).optional(),
  })
  .strict();
export type DoctorInput = z.infer<typeof DoctorInput>;

export type CheckStatus = "pass" | "warn" | "fail" | "n/a";

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  message: string;
  detail?: Record<string, unknown>;
}

export interface DoctorResult {
  status: "pass" | "warn" | "fail";
  server_version: string;
  checks: DoctorCheck[];
}

const EXPECTED_BUILTIN_NAMES = [
  "codex-patch",
  "codex-review",
  "codex-test",
  "codex-plan",
  "claude-review",
  "claude-plan",
];

function worst(statuses: CheckStatus[]): "pass" | "warn" | "fail" {
  if (statuses.includes("fail")) return "fail";
  if (statuses.some((s) => s === "warn" || s === "n/a")) return "warn";
  return "pass";
}

function findPackageJson(): string | null {
  let dir: string;
  try {
    dir = dirname(fileURLToPath(import.meta.url));
  } catch {
    dir = process.cwd();
  }
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readPackageVersion(): string | null {
  const path = findPackageJson();
  if (!path) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

export interface DoctorDeps {
  layout: StorageLayout;
  audit: AuditWriter;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export async function doctor(
  rawInput: unknown,
  deps: DoctorDeps,
): Promise<DoctorResult> {
  const input = DoctorInput.parse(rawInput ?? {});
  const checks: DoctorCheck[] = [];

  // 1. config_loadable
  let configLoaded = false;
  let projectTemplateCount = 0;
  try {
    const { config } = loadProjectConfig({ cwd: deps.cwd, env: deps.env });
    configLoaded = true;
    projectTemplateCount = Object.keys(config.templates).length;
    checks.push({
      name: "config_loadable",
      status: "pass",
      message: "RelayOS config loaded successfully.",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    checks.push({
      name: "config_loadable",
      status: "fail",
      message: "Failed to load RelayOS config.",
      detail: { error: message },
    });
  }

  // 2. storage_path_available
  if (existsSync(deps.layout.root)) {
    checks.push({
      name: "storage_path_available",
      status: "pass",
      message: `Storage path exists: ${deps.layout.root}`,
    });
  } else {
    checks.push({
      name: "storage_path_available",
      status: "warn",
      message: `Storage path does not exist (will be created on first handoff): ${deps.layout.root}`,
    });
  }

  // 3. storage_listable
  try {
    const envs = await listEnvelopes(deps.layout);
    checks.push({
      name: "storage_listable",
      status: "pass",
      message: `Storage listable; ${envs.length} envelope(s) found.`,
      detail: { count: envs.length },
    });
  } catch (e) {
    checks.push({
      name: "storage_listable",
      status: "fail",
      message: "Failed to list envelopes.",
      detail: { error: e instanceof Error ? e.message : String(e) },
    });
  }

  // 4. storage_writable
  const probeName = `.relayos-doctor-probe-${Math.random().toString(36).slice(2)}`;
  const probePath = resolve(deps.layout.root, probeName);
  try {
    await mkdir(deps.layout.root, { recursive: true });
    await writeFile(probePath, "doctor-probe", "utf8");
    checks.push({
      name: "storage_writable",
      status: "pass",
      message: "Storage directory is writable.",
    });
  } catch (e) {
    checks.push({
      name: "storage_writable",
      status: "fail",
      message: "Storage directory is not writable.",
      detail: { error: e instanceof Error ? e.message : String(e) },
    });
  } finally {
    try {
      await unlink(probePath);
    } catch {
      // probe may not exist; ignore
    }
  }

  // 5. builtin_templates_loaded
  const loadedNames = Object.keys(BUILTIN_TEMPLATES);
  const missing = EXPECTED_BUILTIN_NAMES.filter((n) => !loadedNames.includes(n));
  if (loadedNames.length === EXPECTED_BUILTIN_NAMES.length && missing.length === 0) {
    checks.push({
      name: "builtin_templates_loaded",
      status: "pass",
      message: `All ${EXPECTED_BUILTIN_NAMES.length} built-in templates loaded.`,
    });
  } else {
    checks.push({
      name: "builtin_templates_loaded",
      status: "fail",
      message: "Built-in template set is incomplete.",
      detail: { loaded: loadedNames, missing },
    });
  }

  // 6. project_templates_valid
  if (configLoaded) {
    checks.push({
      name: "project_templates_valid",
      status: "pass",
      message: `${projectTemplateCount} project template(s) loaded.`,
      detail: { count: projectTemplateCount },
    });
  } else {
    checks.push({
      name: "project_templates_valid",
      status: "n/a",
      message: "Skipped: config did not load.",
    });
  }

  // 7. list_handoffs_ok
  try {
    const r = await listHandoffs({}, { layout: deps.layout });
    if (Array.isArray(r)) {
      checks.push({
        name: "list_handoffs_ok",
        status: "pass",
        message: `list_handoffs returned ${r.length} item(s).`,
      });
    } else {
      checks.push({
        name: "list_handoffs_ok",
        status: "fail",
        message: "list_handoffs did not return an array.",
      });
    }
  } catch (e) {
    checks.push({
      name: "list_handoffs_ok",
      status: "fail",
      message: "list_handoffs threw.",
      detail: { error: e instanceof Error ? e.message : String(e) },
    });
  }

  // 8. read_latest_handoff_shape_ok
  try {
    const r = await readLatestHandoff(
      { assigned_to: "codex" },
      { layout: deps.layout, audit: deps.audit },
    );
    const shapeOk =
      r !== null &&
      typeof r === "object" &&
      "envelope" in r &&
      "events" in r &&
      Array.isArray((r as { events: unknown }).events);
    if (shapeOk) {
      checks.push({
        name: "read_latest_handoff_shape_ok",
        status: "pass",
        message: "read_latest_handoff returned expected shape.",
      });
    } else {
      checks.push({
        name: "read_latest_handoff_shape_ok",
        status: "fail",
        message: "read_latest_handoff returned unexpected shape.",
      });
    }
  } catch (e) {
    checks.push({
      name: "read_latest_handoff_shape_ok",
      status: "fail",
      message: "read_latest_handoff threw.",
      detail: { error: e instanceof Error ? e.message : String(e) },
    });
  }

  // 9. version_consistency
  const pkgVersion = input.package_version ?? readPackageVersion();
  if (pkgVersion === null) {
    checks.push({
      name: "version_consistency",
      status: "warn",
      message: "Could not read package.json version.",
      detail: { server_version: SERVER_VERSION },
    });
  } else if (pkgVersion === SERVER_VERSION) {
    checks.push({
      name: "version_consistency",
      status: "pass",
      message: `package.json and SERVER_VERSION agree (${SERVER_VERSION}).`,
    });
  } else {
    checks.push({
      name: "version_consistency",
      status: "warn",
      message: "package.json version does not match SERVER_VERSION.",
      detail: { package_version: pkgVersion, server_version: SERVER_VERSION },
    });
  }

  return {
    status: worst(checks.map((c) => c.status)),
    server_version: SERVER_VERSION,
    checks,
  };
}
