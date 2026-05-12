import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  Envelope,
  type HandoffInput,
  type EnvelopeStatus,
  type SpawnResult,
} from "./schema.js";
import { newHandoffId } from "./id.js";
import { envelopePath, type StorageLayout } from "./storage.js";

export function buildEnvelope(input: HandoffInput, launchCommand: string): Envelope {
  const now = new Date().toISOString();
  const id = newHandoffId();
  const env: Envelope = {
    id,
    created_at: now,
    updated_at: now,
    status: "recorded",
    source_agent: input.source_agent,
    target_agent: input.target_agent,
    model: input.model,
    effort: input.effort,
    execution_mode: input.execution_mode,
    task_title: input.task_title,
    task_description: input.task_description,
    allowed_files: input.allowed_files,
    forbidden_files: input.forbidden_files,
    constraints: input.constraints,
    expected_output: input.expected_output,
    working_dir: input.working_dir,
    auto_spawn: input.auto_spawn,
    launch_command: launchCommand,
    audit_metadata: {
      parent_handoff_id: input.audit_metadata?.parent_handoff_id,
      source_session_id: input.audit_metadata?.source_session_id,
      tags: input.audit_metadata?.tags ?? [],
      event_count: 0,
      last_event_ts: now,
      cli_detection: {
        target_binary: input.target_agent,
        found: false,
      },
      enforcement_notes: [],
    },
  };
  return Envelope.parse(env);
}

export async function writeEnvelope(
  layout: StorageLayout,
  env: Envelope,
): Promise<string> {
  env.updated_at = new Date().toISOString();
  const path = envelopePath(layout, env.id);
  await writeFile(path, JSON.stringify(env, null, 2) + "\n", "utf8");
  return path;
}

export async function readEnvelope(
  layout: StorageLayout,
  id: string,
): Promise<Envelope | null> {
  const path = envelopePath(layout, id);
  if (!existsSync(path)) return null;
  const raw = await readFile(path, "utf8");
  return Envelope.parse(JSON.parse(raw));
}

export async function listEnvelopes(layout: StorageLayout): Promise<Envelope[]> {
  if (!existsSync(layout.envelopesDir)) return [];
  const entries = await readdir(layout.envelopesDir);
  const envs: Envelope[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await readFile(`${layout.envelopesDir}/${name}`, "utf8");
      envs.push(Envelope.parse(JSON.parse(raw)));
    } catch {
      // skip unparseable files; resilience over strictness for `list`
    }
  }
  envs.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return envs;
}

export function applyStatus(env: Envelope, status: EnvelopeStatus): Envelope {
  env.status = status;
  env.updated_at = new Date().toISOString();
  return env;
}

export function applySpawnResult(env: Envelope, result: SpawnResult): Envelope {
  env.spawn = result;
  env.status = result.exit_code === 0 ? "completed" : "failed";
  env.updated_at = new Date().toISOString();
  return env;
}

export function bumpAuditCounter(env: Envelope, lastTs: string): Envelope {
  env.audit_metadata.event_count += 1;
  env.audit_metadata.last_event_ts = lastTs;
  return env;
}
