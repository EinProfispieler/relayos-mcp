import {
  CreateFromTemplateInput,
  type HandoffInput,
} from "../schema.js";
import { loadProjectConfig } from "../config.js";
import { resolveTemplate } from "../templates/resolve.js";
import {
  createHandoff,
  type CreateHandoffResult,
  type CreateHandoffDeps,
} from "./create_handoff.js";

export interface CreateFromTemplateDeps extends CreateHandoffDeps {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

const TITLE_MAX = 80;

export function deriveTitle(task: string): string {
  const firstLine = task.split(/\r?\n/)[0]!.trim();
  let title = firstLine.length > 0 ? firstLine : task.trim();
  if (title.length > TITLE_MAX) title = title.slice(0, TITLE_MAX);
  title = title.replace(/[.!?]+$/u, "").trim();
  return title;
}

export async function createHandoffFromTemplate(
  rawInput: unknown,
  deps: CreateFromTemplateDeps,
): Promise<CreateHandoffResult> {
  const input = CreateFromTemplateInput.parse(rawInput);
  const { config } = loadProjectConfig({ cwd: deps.cwd, env: deps.env });
  const resolved = resolveTemplate(input.template, config, input.overrides);

  const tags = [
    ...(input.audit_metadata?.tags ?? []),
    `template:${resolved.name}`,
  ];

  const handoffInput: HandoffInput = {
    source_agent: "claude",
    target_agent: resolved.target_agent,
    model: resolved.model,
    effort: resolved.effort,
    execution_mode: resolved.execution_mode,
    task_title: input.task_title ?? deriveTitle(input.task),
    task_description: input.task,
    allowed_files: resolved.allowed_files,
    forbidden_files: resolved.forbidden_files,
    constraints: resolved.constraints,
    expected_output: resolved.expected_output,
    working_dir: input.overrides?.working_dir,
    auto_spawn: input.auto_spawn,
    audit_metadata: {
      ...input.audit_metadata,
      tags,
    },
  };

  return createHandoff(handoffInput, deps);
}
