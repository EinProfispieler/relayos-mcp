import { z } from "zod";
import { listEnvelopes } from "../envelope.js";
import { envelopePath, type StorageLayout } from "../storage.js";
import type { Envelope } from "../schema.js";

export const ListOpenHandoffsInput = z
  .object({
    assigned_to: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict();
export type ListOpenHandoffsInput = z.infer<typeof ListOpenHandoffsInput>;

export interface OpenHandoffSummary {
  id: string;
  title: string;
  assigned_to: string;
  status: "recorded" | "spawning";
  created_at: string;
  tags: string[];
  path: string;
}

const OPEN_STATUSES = new Set<Envelope["status"]>(["recorded", "spawning"]);

export async function listOpenHandoffs(
  rawInput: unknown,
  deps: { layout: StorageLayout },
): Promise<OpenHandoffSummary[]> {
  const input = ListOpenHandoffsInput.parse(rawInput ?? {});
  const limit = input.limit ?? 20;
  const all = await listEnvelopes(deps.layout);
  const out: OpenHandoffSummary[] = [];
  for (const e of all) {
    if (!OPEN_STATUSES.has(e.status)) continue;
    if (input.assigned_to !== undefined && e.target_agent !== input.assigned_to)
      continue;
    out.push({
      id: e.id,
      title: e.task_title,
      assigned_to: e.target_agent,
      status: e.status as "recorded" | "spawning",
      created_at: e.created_at,
      tags: [...(e.audit_metadata.tags ?? [])],
      path: envelopePath(deps.layout, e.id),
    });
    if (out.length >= limit) break;
  }
  return out;
}
