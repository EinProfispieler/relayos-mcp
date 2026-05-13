import { z } from "zod";
import { loadProjectConfig } from "../config.js";
import { BUILTIN_TEMPLATES } from "../templates/builtin.js";
import { resolveStorageLayout } from "../storage.js";
import type { RelayConfig } from "../schema.js";

export const InspectConfigInput = z.object({}).strict();
export type InspectConfigInput = z.infer<typeof InspectConfigInput>;

export type ConfigSource = "explicit-env" | "upward-search" | "default";

export interface InspectConfigOk {
  status: "ok";
  config_source: ConfigSource;
  config_path: string | null;
  storage_dir: string;
  templates: {
    builtin: string[];
    project: string[];
    shadowed: string[];
    total: number;
  };
  resolved_config: RelayConfig;
  warnings: string[];
}

export interface InspectConfigError {
  status: "error";
  config_source: ConfigSource;
  config_path: string | null;
  storage_dir: string;
  templates: {
    builtin: string[];
    project: string[];
    shadowed: string[];
    total: number;
  };
  error: {
    type: "malformed_config" | "missing_file" | "invalid_schema" | "unknown";
    message: string;
    path?: string;
  };
  warnings: string[];
}

export type InspectConfigResult = InspectConfigOk | InspectConfigError;

export interface InspectConfigDeps {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

function classifyError(message: string): InspectConfigError["error"]["type"] {
  if (message.startsWith("malformed JSON")) return "malformed_config";
  if (message.startsWith("RELAYOS_CONFIG points to missing file"))
    return "missing_file";
  if (message.startsWith("invalid RelayOS config")) return "invalid_schema";
  return "unknown";
}

function extractPath(message: string): string | undefined {
  const m = message.match(/ at (\/[^\s:]+)/);
  return m ? m[1] : undefined;
}

function resolveSource(
  env: NodeJS.ProcessEnv,
  configPath: string | null,
): ConfigSource {
  const explicit = env.RELAYOS_CONFIG?.trim();
  if (explicit && explicit.length > 0) return "explicit-env";
  if (configPath) return "upward-search";
  return "default";
}

export function inspectConfig(
  rawInput: unknown,
  deps: InspectConfigDeps = {},
): InspectConfigResult {
  InspectConfigInput.parse(rawInput ?? {});
  const env = deps.env ?? process.env;
  const layout = resolveStorageLayout(env);
  const builtinNames = Object.keys(BUILTIN_TEMPLATES).sort();

  try {
    const { config, source } = loadProjectConfig({ cwd: deps.cwd, env });
    const projectNames = Object.keys(config.templates).sort();
    const builtinSet = new Set(builtinNames);
    const shadowed = projectNames.filter((n) => builtinSet.has(n)).sort();
    const allNames = new Set<string>([...builtinNames, ...projectNames]);

    const warnings: string[] = [];
    for (const n of shadowed) {
      warnings.push(`project template "${n}" overrides built-in template`);
    }

    return {
      status: "ok",
      config_source: resolveSource(env, source),
      config_path: source,
      storage_dir: layout.root,
      templates: {
        builtin: builtinNames,
        project: projectNames,
        shadowed,
        total: allNames.size,
      },
      resolved_config: config,
      warnings,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const type = classifyError(message);
    const path = extractPath(message);
    return {
      status: "error",
      config_source: resolveSource(env, null),
      config_path: path ?? null,
      storage_dir: layout.root,
      templates: {
        builtin: builtinNames,
        project: [],
        shadowed: [],
        total: builtinNames.length,
      },
      error: { type, message, ...(path ? { path } : {}) },
      warnings: [message],
    };
  }
}
