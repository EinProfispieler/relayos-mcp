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

export const ExpectedOutputInput = z
  .union([
    z.string().min(1, "expected_output is required"),
    z.array(z.string().min(1, "expected_output entries are required")).min(1),
  ])
  .transform((v) => (Array.isArray(v) ? v : [v]));
export type ExpectedOutputInput = z.infer<typeof ExpectedOutputInput>;

export const ExpectedOutputEnvelope = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? v : [v]));
export type ExpectedOutputEnvelope = z.infer<typeof ExpectedOutputEnvelope>;

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
    expected_output: ExpectedOutputInput,
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
    expected_output: ExpectedOutputEnvelope,
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

export const ChatSessionRecord = z
  .object({
    session_id: z.string().min(1),
    started_at: z.string().datetime(),
    ended_at: z.string().datetime(),
    message_count: z.number().int().nonnegative(),
    exit_reason: z.enum(["user_exit", "eof", "sigint"]),
  })
  .strict();
export type ChatSessionRecord = z.infer<typeof ChatSessionRecord>;

// ---------- v0.2.0 templates ----------

export const TemplateOverrides = z
  .object({
    target_agent: AgentName.optional(),
    model: z.string().min(1).optional(),
    effort: Effort.optional(),
    execution_mode: ExecutionMode.optional(),
    allowed_files: z.array(z.string()).optional(),
    forbidden_files: z.array(z.string()).optional(),
    constraints: z.array(z.string()).optional(),
    expected_output: z
      .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
      .optional(),
    working_dir: z.string().optional(),
  })
  .strict();
export type TemplateOverrides = z.infer<typeof TemplateOverrides>;

export const Template = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    target_agent: AgentName,
    model: z.string().min(1),
    effort: Effort,
    execution_mode: ExecutionMode,
    allowed_files: z.array(z.string()),
    forbidden_files: z.array(z.string()),
    constraints: z.array(z.string()),
    expected_output: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type Template = z.infer<typeof Template>;

export const RelayConfigDefaults = z
  .object({
    source_agent: AgentName.optional(),
    forbidden_files: z.array(z.string()).optional(),
    constraints: z.array(z.string()).optional(),
  })
  .strict();
export type RelayConfigDefaults = z.infer<typeof RelayConfigDefaults>;

export const RelayConfig = z
  .object({
    version: z.literal(1).optional(),
    defaults: RelayConfigDefaults.optional(),
    templates: z.record(z.string(), TemplateOverrides).default({}),
  })
  .strict();
export type RelayConfig = z.infer<typeof RelayConfig>;

export const CreateFromTemplateInput = z
  .object({
    template: z.string().min(1),
    task: z.string().min(1, "task is required"),
    task_title: z.string().min(1).optional(),
    overrides: TemplateOverrides.optional(),
    auto_spawn: z.boolean().default(false),
    audit_metadata: AuditMetadataInput.optional(),
  })
  .strict();
export type CreateFromTemplateInput = z.infer<typeof CreateFromTemplateInput>;
