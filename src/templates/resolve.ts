import {
  Template,
  type TemplateOverrides,
  type RelayConfig,
  type AgentName,
} from "../schema.js";
import { BUILTIN_TEMPLATES, BUILTIN_DEFAULTS } from "./builtin.js";

export class TemplateNotFoundError extends Error {
  readonly code = "template_not_found";

  constructor(name: string, available: string[]) {
    super(
      `template "${name}" not found. Available: ${available.sort().join(", ")}`,
    );
  }
}

export interface ResolvedTemplate extends Template {
  source: "builtin" | "project";
}

function applyOverridesOnto(
  base: Partial<Template>,
  o: Partial<TemplateOverrides> | undefined,
): Partial<Template> {
  if (!o) return base;
  const out: Partial<Template> = { ...base };
  if (o.target_agent !== undefined) out.target_agent = o.target_agent;
  if (o.model !== undefined) out.model = o.model;
  if (o.effort !== undefined) out.effort = o.effort;
  if (o.execution_mode !== undefined) out.execution_mode = o.execution_mode;
  if (o.allowed_files !== undefined) out.allowed_files = [...o.allowed_files];
  if (o.forbidden_files !== undefined) {
    out.forbidden_files = [...o.forbidden_files];
  }
  if (o.constraints !== undefined) out.constraints = [...o.constraints];
  if (o.expected_output !== undefined) {
    out.expected_output = Array.isArray(o.expected_output)
      ? [...o.expected_output]
      : [o.expected_output];
  }
  return out;
}

function applyDefaultsOnto(
  base: Partial<Template>,
  defs: RelayConfig["defaults"],
): Partial<Template> {
  if (!defs) return base;
  const out: Partial<Template> = { ...base };

  if (defs.forbidden_files) {
    out.forbidden_files = Array.from(
      new Set([...(out.forbidden_files ?? []), ...defs.forbidden_files]),
    );
  }
  if (defs.constraints) {
    out.constraints = Array.from(
      new Set([...(out.constraints ?? []), ...defs.constraints]),
    );
  }
  return out;
}

export function resolveTemplate(
  name: string,
  cfg: RelayConfig,
  overrides?: TemplateOverrides,
): Template {
  const builtin = BUILTIN_TEMPLATES[name];
  const projectOverride = cfg.templates[name];

  let base: Partial<Template>;
  if (builtin) {
    base = { ...builtin };
  } else if (projectOverride) {
    base = { name, description: `Project template "${name}"` };
  } else {
    throw new TemplateNotFoundError(name, Object.keys(BUILTIN_TEMPLATES));
  }

  base = applyDefaultsOnto(base, cfg.defaults);
  if (builtin && projectOverride) {
    base = applyOverridesOnto(base, projectOverride);
  } else if (!builtin && projectOverride) {
    base = applyOverridesOnto(base, projectOverride);
  }
  base = applyOverridesOnto(base, overrides);

  base.allowed_files ??= [];
  base.forbidden_files ??= [...BUILTIN_DEFAULTS.forbidden_files];
  base.constraints ??= [];

  return Template.parse(base);
}

export interface ListedTemplate extends ResolvedTemplate {}

export function listAllTemplates(
  cfg: RelayConfig,
  filter?: { target_agent?: AgentName },
): ListedTemplate[] {
  const names = new Set<string>([
    ...Object.keys(BUILTIN_TEMPLATES),
    ...Object.keys(cfg.templates),
  ]);

  const out: ListedTemplate[] = [];
  for (const name of names) {
    const t = resolveTemplate(name, cfg);
    const isProject = cfg.templates[name] !== undefined;
    if (filter?.target_agent && t.target_agent !== filter.target_agent) continue;
    out.push({ ...t, source: isProject ? "project" : "builtin" });
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
