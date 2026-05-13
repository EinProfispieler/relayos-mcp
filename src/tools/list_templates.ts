import { z } from "zod";
import { AgentName } from "../schema.js";
import { loadProjectConfig } from "../config.js";
import { listAllTemplates, type ListedTemplate } from "../templates/resolve.js";

export const ListTemplatesInput = z
  .object({
    target_agent: AgentName.optional(),
  })
  .strict();
export type ListTemplatesInput = z.infer<typeof ListTemplatesInput>;

export interface ListTemplatesResult {
  templates: ListedTemplate[];
  config_source: string | null;
}

export interface ListTemplatesDeps {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export function listTemplates(
  rawInput: unknown,
  deps: ListTemplatesDeps = {},
): ListTemplatesResult {
  const input = ListTemplatesInput.parse(rawInput);
  const { config, source } = loadProjectConfig({ cwd: deps.cwd, env: deps.env });
  const templates = listAllTemplates(config, { target_agent: input.target_agent });
  return { templates, config_source: source };
}
