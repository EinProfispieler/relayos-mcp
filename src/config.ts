import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { RelayConfig } from "./schema.js";

export interface LoadOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface LoadedConfig {
  config: RelayConfig;
  source: string | null;
}

const FILE_NAME = "config.json";
const DIR_NAME = ".relayos";

function tryParse(absPath: string): RelayConfig {
  let raw: string;
  try {
    raw = readFileSync(absPath, "utf8");
  } catch (e) {
    throw new Error(
      `failed to read RelayOS config at ${absPath}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `malformed JSON in RelayOS config at ${absPath}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  const r = RelayConfig.safeParse(parsed);
  if (!r.success) {
    const issues = r.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    throw new Error(`invalid RelayOS config at ${absPath}: ${issues}`);
  }
  return r.data;
}

function searchUpward(startDir: string): string | null {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, DIR_NAME, FILE_NAME);
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadProjectConfig(opts: LoadOptions = {}): LoadedConfig {
  const cwd = opts.cwd ?? process.cwd();
  const env = opts.env ?? process.env;

  const explicit = env.RELAYOS_CONFIG?.trim();
  if (explicit && explicit.length > 0) {
    const abs = resolve(explicit);
    if (!existsSync(abs)) {
      throw new Error(`RELAYOS_CONFIG points to missing file: ${abs}`);
    }
    return { config: tryParse(abs), source: abs };
  }

  const found = searchUpward(cwd);
  if (!found) {
    return { config: RelayConfig.parse({}), source: null };
  }

  return { config: tryParse(found), source: found };
}
