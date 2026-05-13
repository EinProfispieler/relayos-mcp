import { z } from "zod";
import {
  AgentName,
  type AuditEvent,
  type Envelope,
} from "../schema.js";
import { listEnvelopes } from "../envelope.js";
import type { StorageLayout } from "../storage.js";
import type { AuditWriter } from "../audit.js";

export const ReadLatestHandoffInput = z
  .object({
    assigned_to: AgentName.optional(),
  })
  .strict();
export type ReadLatestHandoffInput = z.infer<typeof ReadLatestHandoffInput>;

export interface ReadLatestHandoffResult {
  envelope: Envelope | null;
  events: AuditEvent[];
}

const OPEN_STATUSES = new Set<Envelope["status"]>(["recorded", "spawning"]);

export async function readLatestHandoff(
  rawInput: unknown,
  deps: { layout: StorageLayout; audit: AuditWriter },
): Promise<ReadLatestHandoffResult> {
  const input = ReadLatestHandoffInput.parse(rawInput ?? {});
  const all = await listEnvelopes(deps.layout);
  const match = all.find(
    (e) =>
      OPEN_STATUSES.has(e.status) &&
      (input.assigned_to === undefined || e.target_agent === input.assigned_to),
  );
  if (!match) return { envelope: null, events: [] };
  const events = await deps.audit.readByHandoffId(match.id);
  return { envelope: match, events };
}
