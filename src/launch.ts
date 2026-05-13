import { listEnvelopes, readEnvelope } from "./envelope.js";
import { renderClaudeTarget } from "./render/claude.js";
import { renderCodexTarget } from "./render/codex.js";
import type { Envelope } from "./schema.js";
import { resolveStorageLayout } from "./storage.js";

export type LaunchResolutionErrorCode =
  | "unknown_id"
  | "out_of_range"
  | "no_open_handoffs";

export class LaunchResolutionError extends Error {
  constructor(
    public readonly code: LaunchResolutionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LaunchResolutionError";
  }
}

const OPEN_STATUSES = new Set<Envelope["status"]>(["recorded", "spawning"]);

function compareNewestFirst(a: Envelope, b: Envelope): number {
  if (a.created_at !== b.created_at) {
    return a.created_at < b.created_at ? 1 : -1;
  }
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

function openEnvelopes(envelopes: Envelope[]): Envelope[] {
  return envelopes
    .filter((e) => OPEN_STATUSES.has(e.status))
    .sort(compareNewestFirst);
}

export async function resolveHandoff(arg?: string): Promise<Envelope> {
  const selection = arg?.trim();
  const layout = resolveStorageLayout();

  if (selection?.startsWith("h_")) {
    const envelope = await readEnvelope(layout, selection);
    if (!envelope) {
      throw new LaunchResolutionError(
        "unknown_id",
        `handoff ${selection} was not found`,
      );
    }
    return envelope;
  }

  const envelopes = (await listEnvelopes(layout)).sort(compareNewestFirst);

  if (!selection || selection === "latest") {
    const latest = openEnvelopes(envelopes)[0];
    if (!latest) {
      throw new LaunchResolutionError(
        "no_open_handoffs",
        "no open handoffs found",
      );
    }
    return latest;
  }

  if (/^\d+$/.test(selection)) {
    const index = Number(selection) - 1;
    const open = openEnvelopes(envelopes);
    if (index < 0 || index >= open.length) {
      throw new LaunchResolutionError(
        "out_of_range",
        `handoff selection ${selection} is out of range; ${open.length} open handoff(s) available`,
      );
    }
    return open[index]!;
  }

  const exact = envelopes.find((e) => e.id === selection);
  if (exact) return exact;

  throw new LaunchResolutionError(
    "unknown_id",
    `handoff ${selection} was not found`,
  );
}

export function buildLaunchCommand(envelope: Envelope): string {
  return envelope.target_agent === "codex"
    ? renderCodexTarget(envelope).launch_command
    : renderClaudeTarget(envelope).launch_command;
}
