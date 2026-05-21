import {
  HandoffInput,
  type Envelope,
  type AuditEvent,
} from "../schema.js";
import {
  buildEnvelope,
  writeEnvelope,
  applyStatus,
  applySpawnResult,
  bumpAuditCounter,
  readEnvelope,
} from "../envelope.js";
import { envelopePath, type StorageLayout } from "../storage.js";
import type { AuditWriter } from "../audit.js";
import { renderCodexTarget } from "../render/codex.js";
import { renderClaudeTarget } from "../render/claude.js";
import { detectCli, runTarget } from "../spawn/index.js";
import { maybeAutoRecordHandoffExecution } from "../run_ledger.js";

export interface CreateHandoffResult {
  handoff_id: string;
  envelope_path: string;
  launch_command: string;
  status: Envelope["status"];
  advisory_notes: string[];
  cli_detection: Envelope["audit_metadata"]["cli_detection"];
  spawn?: Envelope["spawn"];
  error?: { code: string; message: string };
}

export interface CreateHandoffDeps {
  layout: StorageLayout;
  audit: AuditWriter;
}

async function appendEventAndBump(
  deps: CreateHandoffDeps,
  env: Envelope,
  event: AuditEvent["event"],
  detail?: Record<string, unknown>,
): Promise<AuditEvent> {
  const e = await deps.audit.append(env.id, event, detail);
  bumpAuditCounter(env, e.ts);
  return e;
}

export async function createHandoff(
  rawInput: unknown,
  deps: CreateHandoffDeps,
): Promise<CreateHandoffResult> {
  const input = HandoffInput.parse(rawInput);

  // Build the envelope first so the renderer can stamp the real handoff id
  // into the prompt prefix; if we render from `input` we'd get "(uncommitted)".
  const env = buildEnvelope(input, "");
  const rendered =
    env.target_agent === "codex"
      ? renderCodexTarget(env)
      : renderClaudeTarget(env);
  env.launch_command = rendered.launch_command;
  env.audit_metadata.enforcement_notes = rendered.advisory_notes;

  await writeEnvelope(deps.layout, env);

  await appendEventAndBump(deps, env, "created", {
    source_agent: env.source_agent,
    target_agent: env.target_agent,
    execution_mode: env.execution_mode,
    auto_spawn: env.auto_spawn,
  });
  await appendEventAndBump(deps, env, "validated", { ok: true });

  if (rendered.advisory_notes.length > 0) {
    await appendEventAndBump(deps, env, "advisory_only_enforcement", {
      notes: rendered.advisory_notes,
    });
  }

  await writeEnvelope(deps.layout, env);

  if (!env.auto_spawn) {
    return {
      handoff_id: env.id,
      envelope_path: envelopePath(deps.layout, env.id),
      launch_command: env.launch_command,
      status: env.status,
      advisory_notes: rendered.advisory_notes,
      cli_detection: env.audit_metadata.cli_detection,
    };
  }

  // auto_spawn path
  const detection = await detectCli(env.target_agent);
  env.audit_metadata.cli_detection = detection;

  if (!detection.found) {
    await appendEventAndBump(deps, env, "spawn_failed", {
      reason: "missing_target_cli",
      binary: detection.target_binary,
    });
    await writeEnvelope(deps.layout, env);
    return {
      handoff_id: env.id,
      envelope_path: envelopePath(deps.layout, env.id),
      launch_command: env.launch_command,
      status: env.status,
      advisory_notes: rendered.advisory_notes,
      cli_detection: detection,
      error: {
        code: "missing_target_cli",
        message: `target agent CLI "${detection.target_binary}" not found on PATH; envelope was recorded but no spawn occurred`,
      },
    };
  }

  applyStatus(env, "spawning");
  await writeEnvelope(deps.layout, env);
  await appendEventAndBump(deps, env, "spawn_started", {
    binary: detection.resolved_path,
    argv: rendered.suggested_argv,
  });

  try {
    const result = await runTarget({
      layout: deps.layout,
      handoffId: env.id,
      binary: detection.resolved_path!,
      argv: rendered.suggested_argv,
      workingDir: env.working_dir,
    });
    applySpawnResult(env, result);
    await appendEventAndBump(
      deps,
      env,
      result.exit_code === 0 ? "spawn_completed" : "spawn_failed",
      {
        exit_code: result.exit_code,
        duration_ms: result.duration_ms,
      },
    );
    await writeEnvelope(deps.layout, env);

    // Keep MCP auto_spawn on the same Run Ledger helper as CLI paths.
    // Default OFF unless per-call or env opt-in is enabled.
    // Use the actual execution workspace as the ledger root when provided.
    // This keeps MCP auto_spawn aligned with the handoff's target project
    // instead of forcing writes into the MCP server's process cwd.
    const ledgerCwd = env.working_dir ?? process.cwd();
    await maybeAutoRecordHandoffExecution(ledgerCwd, {
      handoffId: env.id,
      allowedFiles: env.allowed_files,
      workingDir: env.working_dir,
      ownerAgent: env.target_agent,
      finalStatus: result.exit_code === 0 ? "completed" : "failed",
      flagFromCaller: input.record_run_ledger === true,
    });

    const fresh = (await readEnvelope(deps.layout, env.id)) ?? env;
    return {
      handoff_id: fresh.id,
      envelope_path: envelopePath(deps.layout, fresh.id),
      launch_command: fresh.launch_command,
      status: fresh.status,
      advisory_notes: rendered.advisory_notes,
      cli_detection: fresh.audit_metadata.cli_detection,
      spawn: fresh.spawn,
    };
  } catch (err) {
    applyStatus(env, "failed");
    await appendEventAndBump(deps, env, "spawn_failed", {
      reason: "spawn_error",
      message: err instanceof Error ? err.message : String(err),
    });
    await writeEnvelope(deps.layout, env);
    return {
      handoff_id: env.id,
      envelope_path: envelopePath(deps.layout, env.id),
      launch_command: env.launch_command,
      status: env.status,
      advisory_notes: rendered.advisory_notes,
      cli_detection: env.audit_metadata.cli_detection,
      error: {
        code: "spawn_error",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
