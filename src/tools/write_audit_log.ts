import type { StorageLayout } from "../storage.js";
import type { AuditWriter } from "../audit.js";
import { readEnvelope, writeEnvelope, bumpAuditCounter } from "../envelope.js";

export interface WriteAuditInput {
  handoff_id: string;
  event_label: string;
  detail?: Record<string, unknown>;
}

export interface WriteAuditDeps {
  layout: StorageLayout;
  audit: AuditWriter;
}

export async function writeAuditLog(
  rawInput: unknown,
  deps: WriteAuditDeps,
) {
  const input = rawInput as WriteAuditInput;
  if (!input?.handoff_id || typeof input.handoff_id !== "string") {
    throw new Error("handoff_id is required");
  }
  if (!input.event_label || typeof input.event_label !== "string") {
    throw new Error("event_label is required");
  }

  const env = await readEnvelope(deps.layout, input.handoff_id);
  if (!env) throw new Error(`handoff ${input.handoff_id} not found`);

  const ev = await deps.audit.append(env.id, "custom", {
    label: input.event_label,
    ...(input.detail ?? {}),
  });
  bumpAuditCounter(env, ev.ts);
  await writeEnvelope(deps.layout, env);

  return {
    ok: true as const,
    handoff_id: env.id,
    event_count: env.audit_metadata.event_count,
    event_ts: ev.ts,
  };
}
