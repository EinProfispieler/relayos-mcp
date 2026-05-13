import { z } from "zod";
import { AgentName, AuditMetadataInput } from "../schema.js";
import {
  createHandoffFromTemplate,
  type CreateFromTemplateDeps,
} from "./create_handoff_from_template.js";
import type { CreateHandoffResult } from "./create_handoff.js";

export const QuickMode = z.enum(["patch", "review", "test", "plan"]);
export type QuickMode = z.infer<typeof QuickMode>;

export const CreateQuickHandoffInput = z
  .object({
    target_agent: AgentName,
    task: z.string().min(1, "task is required"),
    mode: QuickMode.optional(),
    allowed_files: z.array(z.string()).optional(),
    forbidden_files: z.array(z.string()).optional(),
    constraints: z.array(z.string()).optional(),
    task_title: z.string().min(1).optional(),
    auto_spawn: z.boolean().default(false),
    audit_metadata: AuditMetadataInput.optional(),
  })
  .strict();
export type CreateQuickHandoffInput = z.infer<typeof CreateQuickHandoffInput>;

const DEFAULT_MODE_BY_AGENT: Record<AgentName, QuickMode> = {
  codex: "patch",
  claude: "plan",
};

const TEMPLATE_BY_AGENT_AND_MODE: Record<string, string> = {
  "codex|patch": "codex-patch",
  "codex|review": "codex-review",
  "codex|test": "codex-test",
  "codex|plan": "codex-plan",
  "claude|review": "claude-review",
  "claude|plan": "claude-plan",
};

export class QuickHandoffNoTemplateError extends Error {
  readonly code = "quick_handoff_no_template";
  readonly target_agent: AgentName;
  readonly mode: QuickMode;

  constructor(target_agent: AgentName, mode: QuickMode) {
    super(
      `No built-in template for target_agent="${target_agent}", mode="${mode}". ` +
        `Use create_handoff_from_template with a project template, or create_handoff for full control.`,
    );
    this.target_agent = target_agent;
    this.mode = mode;
  }
}

export async function createQuickHandoff(
  rawInput: unknown,
  deps: CreateFromTemplateDeps,
): Promise<CreateHandoffResult> {
  const input = CreateQuickHandoffInput.parse(rawInput);
  const mode = input.mode ?? DEFAULT_MODE_BY_AGENT[input.target_agent];
  const template = TEMPLATE_BY_AGENT_AND_MODE[`${input.target_agent}|${mode}`];
  if (!template) {
    throw new QuickHandoffNoTemplateError(input.target_agent, mode);
  }

  const overrides: Record<string, unknown> = {};
  if (input.allowed_files !== undefined) {
    overrides.allowed_files = input.allowed_files;
  }
  if (input.forbidden_files !== undefined) {
    overrides.forbidden_files = input.forbidden_files;
  }
  if (input.constraints !== undefined) {
    overrides.constraints = input.constraints;
  }

  return createHandoffFromTemplate(
    {
      template,
      task: input.task,
      task_title: input.task_title,
      overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
      auto_spawn: input.auto_spawn,
      audit_metadata: input.audit_metadata,
    },
    deps,
  );
}
