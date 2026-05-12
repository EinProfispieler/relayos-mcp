import { HandoffInput } from "../schema.js";
import { readEnvelope, bumpAuditCounter, writeEnvelope } from "../envelope.js";
import type { StorageLayout } from "../storage.js";
import type { AuditWriter } from "../audit.js";
import { renderClaudeTarget } from "../render/claude.js";
import { renderCodexTarget } from "../render/codex.js";

export interface RenderInput {
  handoff_id?: string;
  inline?: unknown;
}

export interface RenderDeps {
  layout: StorageLayout;
  audit: AuditWriter;
}

async function resolveSource(
  input: RenderInput,
  deps: RenderDeps,
): Promise<
  | { kind: "envelope"; envelope: Awaited<ReturnType<typeof readEnvelope>> & object }
  | { kind: "inline"; input: HandoffInput }
  | { kind: "error"; message: string }
> {
  const hasId = typeof input.handoff_id === "string" && input.handoff_id.length > 0;
  const hasInline = input.inline !== undefined;
  if (hasId === hasInline) {
    return {
      kind: "error",
      message: "exactly one of {handoff_id, inline} is required",
    };
  }
  if (hasId) {
    const env = await readEnvelope(deps.layout, input.handoff_id!);
    if (!env) {
      return { kind: "error", message: `handoff ${input.handoff_id} not found` };
    }
    return { kind: "envelope", envelope: env };
  }
  const parsed = HandoffInput.safeParse(input.inline);
  if (!parsed.success) {
    return {
      kind: "error",
      message: `invalid inline handoff: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    };
  }
  return { kind: "inline", input: parsed.data };
}

export async function renderClaudePrompt(
  rawInput: unknown,
  deps: RenderDeps,
) {
  const input = (rawInput as RenderInput) ?? {};
  const src = await resolveSource(input, deps);
  if (src.kind === "error") throw new Error(src.message);

  const rendered =
    src.kind === "envelope"
      ? renderClaudeTarget(src.envelope)
      : renderClaudeTarget(src.input);

  if (src.kind === "envelope") {
    const ev = await deps.audit.append(src.envelope.id, "rendered_claude_prompt", {
      target: "claude",
      advisory_notes: rendered.advisory_notes,
    });
    bumpAuditCounter(src.envelope, ev.ts);
    await writeEnvelope(deps.layout, src.envelope);
  }

  return {
    prompt: rendered.prompt,
    suggested_argv: rendered.suggested_argv,
    launch_command: rendered.launch_command,
    advisory_notes: rendered.advisory_notes,
  };
}

export async function renderCodexPrompt(
  rawInput: unknown,
  deps: RenderDeps,
) {
  const input = (rawInput as RenderInput) ?? {};
  const src = await resolveSource(input, deps);
  if (src.kind === "error") throw new Error(src.message);

  const rendered =
    src.kind === "envelope"
      ? renderCodexTarget(src.envelope)
      : renderCodexTarget(src.input);

  if (src.kind === "envelope") {
    const ev = await deps.audit.append(src.envelope.id, "rendered_codex_prompt", {
      target: "codex",
      advisory_notes: rendered.advisory_notes,
    });
    bumpAuditCounter(src.envelope, ev.ts);
    await writeEnvelope(deps.layout, src.envelope);
  }

  return {
    prompt: rendered.prompt,
    suggested_argv: rendered.suggested_argv,
    launch_command: rendered.launch_command,
    advisory_notes: rendered.advisory_notes,
  };
}
