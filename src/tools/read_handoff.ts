import { readEnvelope } from "../envelope.js";
import type { StorageLayout } from "../storage.js";
import type { AuditWriter } from "../audit.js";

export interface ReadInput {
  handoff_id: string;
}

export async function readHandoff(
  rawInput: unknown,
  deps: { layout: StorageLayout; audit: AuditWriter },
) {
  const input = rawInput as ReadInput;
  if (!input?.handoff_id || typeof input.handoff_id !== "string") {
    throw new Error("handoff_id is required");
  }
  const envelope = await readEnvelope(deps.layout, input.handoff_id);
  if (!envelope) {
    throw new Error(`handoff ${input.handoff_id} not found`);
  }
  const events = await deps.audit.readByHandoffId(input.handoff_id);
  return { envelope, events };
}
