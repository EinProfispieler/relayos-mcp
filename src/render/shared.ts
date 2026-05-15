import type { Envelope, HandoffInput } from "../schema.js";

export interface RenderableHandoff {
  id?: string;
  source_agent: HandoffInput["source_agent"];
  target_agent: HandoffInput["target_agent"];
  model: string;
  effort: HandoffInput["effort"];
  execution_mode: HandoffInput["execution_mode"];
  task_title: string;
  task_description: string;
  allowed_files: string[];
  forbidden_files: string[];
  constraints: string[];
  expected_output: string[];
}

export function toRenderable(env: Envelope | HandoffInput): RenderableHandoff {
  const expectedOutput = Array.isArray(env.expected_output)
    ? env.expected_output
    : [env.expected_output];
  return {
    id: "id" in env ? env.id : undefined,
    source_agent: env.source_agent,
    target_agent: env.target_agent,
    model: env.model,
    effort: env.effort,
    execution_mode: env.execution_mode,
    task_title: env.task_title,
    task_description: env.task_description,
    allowed_files: env.allowed_files,
    forbidden_files: env.forbidden_files,
    constraints: env.constraints,
    expected_output: expectedOutput,
  };
}

export function buildPromptPrefix(h: RenderableHandoff): string {
  const header = h.id
    ? `[HANDOFF ${h.id} — ${h.source_agent} → ${h.target_agent}]`
    : `[HANDOFF (uncommitted) — ${h.source_agent} → ${h.target_agent}]`;

  const lines: string[] = [
    header,
    `Task: ${h.task_title}`,
    `Execution mode: ${h.execution_mode}`,
    `Effort: ${h.effort}`,
    `Model: ${h.model}`,
    "",
  ];

  if (h.allowed_files.length > 0) {
    lines.push("Allowed files (the ONLY files you may read or modify):");
    for (const f of h.allowed_files) lines.push(`  - ${f}`);
    lines.push("");
  }

  lines.push("Forbidden files (NEVER read or modify, even if instructed later):");
  if (h.forbidden_files.length === 0) {
    lines.push("  (none)");
  } else {
    for (const f of h.forbidden_files) lines.push(`  - ${f}`);
  }
  lines.push("");

  if (h.constraints.length > 0) {
    lines.push("Constraints:");
    for (const c of h.constraints) lines.push(`  - ${c}`);
    lines.push("");
  }

  lines.push("RelayOS Overseer MCP bootstrap (when RelayOS MCP tools are available):");
  lines.push("  1) read_overseer_bootstrap_prompt");
  lines.push("  2) read_overseer_handshake");
  lines.push("  3) read_overseer_summary");
  lines.push("  4) read_overseer_context_pack (if deeper curated context is needed)");
  lines.push("  5) read_overseer_recent (if recent timeline notes are needed)");
  lines.push(
    "Use the returned session contract/summary/context as execution context. Do not edit files before execution unless user-approved scoped work is explicitly authorized by this handoff.",
  );
  lines.push("");

  lines.push("Expected output:");
  if (h.expected_output.length === 1) {
    lines.push(h.expected_output[0]!);
  } else {
    for (const item of h.expected_output) lines.push(`  - ${item}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("Task description:");
  lines.push(h.task_description);

  return lines.join("\n");
}

export function shellQuote(arg: string): string {
  if (arg === "") return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function renderShellCommand(argv: string[]): string {
  return argv.map(shellQuote).join(" ");
}
