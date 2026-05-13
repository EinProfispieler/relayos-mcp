import { z } from "zod";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

const BUILTIN_CODEX_TEMPLATE_NAMES = [
  "codex-patch",
  "codex-review",
  "codex-test",
  "codex-plan",
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

function projectRoot(): string | null {
  const pkg = findPackageJson();
  return pkg ? dirname(pkg) : null;
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

export interface CodexCliProbe {
  onPath: boolean;
  version?: string;
  error?: string;
}

async function probeCodexCli(command = "codex", env?: NodeJS.ProcessEnv): Promise<CodexCliProbe> {
  return new Promise((resolveProbe) => {
    execFile(command, ["--version"], { env, timeout: 2_000 }, (error, stdout, stderr) => {
      if (!error) {
        resolveProbe({ onPath: true, version: stdout.trim() || stderr.trim() || "unknown" });
        return;
      }

      const code = (error as NodeJS.ErrnoException).code;
      resolveProbe({
        onPath: code !== "ENOENT",
        error: error.message,
      });
    });
  });
}

function collectBuiltinCodexModels(): Record<string, string> {
  return Object.fromEntries(
    BUILTIN_CODEX_TEMPLATE_NAMES.map((name) => [
      name,
      BUILTIN_TEMPLATES[name]?.model ?? "missing",
    ]),
  );
}

function latestMtimeMs(path: string): number | null {
  if (!existsSync(path)) return null;
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;

  let latest: number | null = null;
  for (const entry of readdirSync(path)) {
    const childLatest = latestMtimeMs(join(path, entry));
    if (childLatest !== null) latest = latest === null ? childLatest : Math.max(latest, childLatest);
  }
  return latest;
}

function runtimeStalenessCheck(root: string): DoctorCheck {
  const distDir = join(root, "dist");
  if (!existsSync(distDir)) {
    return {
      name: "runtime_dist_fresh",
      status: "pass",
      message: "dist/ is not present; runtime staleness check skipped.",
      detail: { skipped: true, reason: "dist_missing" },
    };
  }

  const srcFiles = [
    join(root, "src", "templates", "builtin.ts"),
    join(root, "src", "tools", "doctor.ts"),
    join(root, "src", "index.ts"),
  ].filter((path) => existsSync(path));
  const distMtime = latestMtimeMs(distDir);
  const staleSources = srcFiles.filter((path) => {
    const srcMtime = latestMtimeMs(path);
    return distMtime !== null && srcMtime !== null && srcMtime > distMtime;
  });

  if (distMtime !== null && staleSources.length === 0) {
    return {
      name: "runtime_dist_fresh",
      status: "pass",
      message: "dist/ appears up to date with relevant src/ files.",
    };
  }

  return {
    name: "runtime_dist_fresh",
    status: "warn",
    message:
      "dist/ appears older than relevant src/ files; run `npm run build` and restart Claude/MCP.",
    detail: {
      stale_sources: staleSources.map((path) => path.slice(root.length + 1)),
    },
  };
}

export interface DoctorDeps {
  layout: StorageLayout;
  audit: AuditWriter;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  codexProbe?: () => Promise<CodexCliProbe>;
  runtimeRoot?: string;
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

  // 6. builtin_codex_template_models
  const codexTemplateModels = collectBuiltinCodexModels();
  checks.push({
    name: "builtin_codex_template_models",
    status: "pass",
    message: "Built-in Codex template default models reported.",
    detail: { templates: codexTemplateModels },
  });

  // 7. builtin_codex_model_compatibility
  const legacyCodexTemplates = Object.entries(codexTemplateModels)
    .filter(([, model]) => model === "gpt-5-codex")
    .map(([name]) => name);
  if (legacyCodexTemplates.length > 0) {
    checks.push({
      name: "builtin_codex_model_compatibility",
      status: "warn",
      message: `Built-in Codex template(s) still default to gpt-5-codex: ${legacyCodexTemplates.join(", ")}.`,
      detail: { templates: legacyCodexTemplates },
    });
  } else {
    checks.push({
      name: "builtin_codex_model_compatibility",
      status: "pass",
      message: "Built-in Codex templates do not default to gpt-5-codex.",
    });
  }

  // 8. codex_cli_available
  const codexProbe = deps.codexProbe ?? (() => probeCodexCli("codex", deps.env));
  const codexCli = await codexProbe();
  if (codexCli.onPath && codexCli.version) {
    checks.push({
      name: "codex_cli_available",
      status: "pass",
      message: `Codex CLI is available (${codexCli.version}).`,
      detail: { on_path: true, version: codexCli.version },
    });
  } else {
    checks.push({
      name: "codex_cli_available",
      status: "warn",
      message: codexCli.onPath
        ? "Codex CLI is on PATH, but `codex --version` did not complete."
        : "Codex CLI was not found on PATH.",
      detail: { on_path: codexCli.onPath, error: codexCli.error },
    });
  }

  // 9. runtime_dist_fresh
  const root = deps.runtimeRoot ?? projectRoot();
  if (root) {
    checks.push(runtimeStalenessCheck(root));
  } else {
    checks.push({
      name: "runtime_dist_fresh",
      status: "pass",
      message: "Project root not found; runtime staleness check skipped.",
      detail: { skipped: true, reason: "project_root_missing" },
    });
  }

  // 10. project_templates_valid
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

  // 11. list_handoffs_ok
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

  // 12. read_latest_handoff_shape_ok
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

  // 13. version_consistency
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
