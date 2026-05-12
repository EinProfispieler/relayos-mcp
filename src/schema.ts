import { z } from "zod";

export const AgentName = z.enum(["claude", "codex"]);
export type AgentName = z.infer<typeof AgentName>;

export const Effort = z.enum(["max", "xhigh", "high", "medium", "low"]);
export type Effort = z.infer<typeof Effort>;

export const ExecutionMode = z.enum([
  "read_only",
  "plan",
  "patch",
  "test",
  "review",
]);
export type ExecutionMode = z.infer<typeof ExecutionMode>;

export const AuditMetadataInput = z
  .object({
    parent_handoff_id: z.string().optional(),
    source_session_id: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  .strict();
export type AuditMetadataInput = z.infer<typeof AuditMetadataInput>;

export const HandoffInput = z
  .object({
    source_agent: AgentName,
    target_agent: AgentName,
    model: z.string().min(1, "model is required"),
    effort: Effort,
    execution_mode: ExecutionMode,
    task_title: z.string().min(1, "task_title is required"),
    task_description: z.string().min(1, "task_description is required"),
    allowed_files: z.array(z.string()).default([]),
    forbidden_files: z.array(z.string()).default([]),
    constraints: z.array(z.string()).default([]),
    expected_output: z.string().min(1, "expected_output is required"),
    working_dir: z.string().optional(),
    auto_spawn: z.boolean().default(false),
    audit_metadata: AuditMetadataInput.optional(),
  })
  .strict();
export type HandoffInput = z.infer<typeof HandoffInput>;

export const CliDetection = z
  .object({
    target_binary: z.string(),
    found: z.boolean(),
    resolved_path: z.string().optional(),
  })
  .strict();
export type CliDetection = z.infer<typeof CliDetection>;

export const AuditMetadata = z
  .object({
    parent_handoff_id: z.string().optional(),
    source_session_id: z.string().optional(),
    tags: z.array(z.string()).default([]),
    event_count: z.number().int().nonnegative(),
    last_event_ts: z.string(),
    cli_detection: CliDetection,
    enforcement_notes: z.array(z.string()).default([]),
  })
  .strict();
export type AuditMetadata = z.infer<typeof AuditMetadata>;

export const SpawnResult = z
  .object({
    started_at: z.string(),
    finished_at: z.string(),
    exit_code: z.number().int(),
    duration_ms: z.number().int().nonnegative(),
    stdout_tail: z.string(),
    stderr_tail: z.string(),
  })
  .strict();
export type SpawnResult = z.infer<typeof SpawnResult>;

export const EnvelopeStatus = z.enum([
  "recorded",
  "spawning",
  "completed",
  "failed",
]);
export type EnvelopeStatus = z.infer<typeof EnvelopeStatus>;

export const Envelope = z
  .object({
    id: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    status: EnvelopeStatus,
    source_agent: AgentName,
    target_agent: AgentName,
    model: z.string(),
    effort: Effort,
    execution_mode: ExecutionMode,
    task_title: z.string(),
    task_description: z.string(),
    allowed_files: z.array(z.string()),
    forbidden_files: z.array(z.string()),
    constraints: z.array(z.string()),
    expected_output: z.string(),
    working_dir: z.string().optional(),
    auto_spawn: z.boolean(),
    launch_command: z.string(),
    audit_metadata: AuditMetadata,
    spawn: SpawnResult.optional(),
  })
  .strict();
export type Envelope = z.infer<typeof Envelope>;

export const AuditEventKind = z.enum([
  "created",
  "validated",
  "rendered_claude_prompt",
  "rendered_codex_prompt",
  "spawn_started",
  "spawn_completed",
  "spawn_failed",
  "advisory_only_enforcement",
  "custom",
]);
export type AuditEventKind = z.infer<typeof AuditEventKind>;

export const AuditEvent = z
  .object({
    ts: z.string(),
    handoff_id: z.string(),
    event: AuditEventKind,
    detail: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type AuditEvent = z.infer<typeof AuditEvent>;
