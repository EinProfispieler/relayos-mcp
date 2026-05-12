import { listEnvelopes } from "../envelope.js";
import type { StorageLayout } from "../storage.js";

export interface ListInput {
  limit?: number;
  source_agent?: string;
  target_agent?: string;
  status?: string;
}

export interface ListSummary {
  id: string;
  created_at: string;
  source_agent: string;
  target_agent: string;
  status: string;
  task_title: string;
  execution_mode: string;
  auto_spawn: boolean;
}

export async function listHandoffs(
  rawInput: unknown,
  deps: { layout: StorageLayout },
): Promise<ListSummary[]> {
  const input = (rawInput as ListInput) ?? {};
  const limit = Math.max(1, Math.min(input.limit ?? 20, 200));
  let envs = await listEnvelopes(deps.layout);
  if (input.source_agent) envs = envs.filter((e) => e.source_agent === input.source_agent);
  if (input.target_agent) envs = envs.filter((e) => e.target_agent === input.target_agent);
  if (input.status) envs = envs.filter((e) => e.status === input.status);
  return envs.slice(0, limit).map((e) => ({
    id: e.id,
    created_at: e.created_at,
    source_agent: e.source_agent,
    target_agent: e.target_agent,
    status: e.status,
    task_title: e.task_title,
    execution_mode: e.execution_mode,
    auto_spawn: e.auto_spawn,
  }));
}
