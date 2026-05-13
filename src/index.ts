import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  AgentName,
  Effort,
  ExecutionMode,
  HandoffInput,
  AuditMetadataInput,
} from "./schema.js";
import { resolveStorageLayout, ensureStorage } from "./storage.js";
import { createAuditWriter } from "./audit.js";
import { createHandoff } from "./tools/create_handoff.js";
import { validateHandoff } from "./tools/validate_handoff.js";
import { listTemplates } from "./tools/list_templates.js";
import { createHandoffFromTemplate } from "./tools/create_handoff_from_template.js";
import {
  renderClaudePrompt,
  renderCodexPrompt,
} from "./tools/render_prompts.js";
import { writeAuditLog } from "./tools/write_audit_log.js";
import { listHandoffs } from "./tools/list_handoffs.js";
import { readHandoff } from "./tools/read_handoff.js";
import { readLatestHandoff } from "./tools/read_latest_handoff.js";

const HandoffInputShape = {
  source_agent: AgentName,
  target_agent: AgentName,
  model: z.string().min(1),
  effort: Effort,
  execution_mode: ExecutionMode,
  task_title: z.string().min(1),
  task_description: z.string().min(1),
  allowed_files: z.array(z.string()).default([]),
  forbidden_files: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  expected_output: z.union([
    z.string().min(1),
    z.array(z.string().min(1)).min(1),
  ]),
  working_dir: z.string().optional(),
  auto_spawn: z.boolean().default(false),
  audit_metadata: AuditMetadataInput.optional(),
} as const;

function jsonResult(value: unknown) {
  // MCP requires structuredContent to be an object; wrap arrays/scalars so
  // callers can still rely on it without losing access to the data.
  const structured =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { result: value };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: structured,
  };
}

export async function buildServer() {
  const layout = resolveStorageLayout();
  await ensureStorage(layout);
  const audit = createAuditWriter(layout);

  const server = new McpServer(
    { name: "relayos-mcp", version: "0.2.1" },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "create_handoff",
    {
      title: "Create handoff",
      description:
        "Low-level: build a handoff envelope by hand with full control of every field " +
        "(target agent, model, effort, execution_mode, file scope, expected output, etc.). " +
        "Prefer create_handoff_from_template for typical \"ask Codex/Claude to do X\" requests; " +
        "use this only when no template fits or you need fields no template exposes. " +
        "Writes the envelope to disk + audit log; if auto_spawn=true, also invokes the target CLI.",
      inputSchema: HandoffInputShape,
    },
    async (args) => {
      const result = await createHandoff(args, { layout, audit });
      return jsonResult(result);
    },
  );

  server.registerTool(
    "validate_handoff",
    {
      title: "Validate handoff",
      description:
        "Dry-run schema validation for a candidate handoff envelope. No side effects — nothing is written. " +
        "Use when iterating on a handoff payload before committing it via create_handoff. " +
        "Wrap the candidate as { \"payload\": ... }. " +
        "Returns ok+normalized data or ok=false+issue list.",
      inputSchema: { payload: z.unknown() },
    },
    async (args) => {
      const result = validateHandoff(args);
      return jsonResult(result);
    },
  );

  server.registerTool(
    "list_templates",
    {
      title: "List handoff templates",
      description:
        "Discover available handoff templates before composing a handoff. " +
        "Use when the user asks \"what can I get Codex/Claude to do?\" or before calling " +
        "create_handoff_from_template if the template name isn't obvious. " +
        "Returns built-in + project-config templates with their target agent, model, effort, " +
        "and execution_mode defaults. Optional target_agent filter.",
      inputSchema: {
        target_agent: AgentName.optional(),
      },
    },
    async (args) => {
      const result = listTemplates(args);
      return jsonResult(result);
    },
  );

  server.registerTool(
    "create_handoff_from_template",
    {
      title: "Create handoff from template",
      description:
        "Preferred way to delegate work to Codex or Claude. " +
        "Use when the user says things like \"ask Codex to fix X\", \"have Codex write a patch for Y\", " +
        "\"get Codex to review Z\", or \"have Claude plan the migration\". " +
        "Pass a short natural-language task plus a template name " +
        "(codex-patch, codex-review, codex-test, codex-plan, claude-review, claude-plan); " +
        "the server fills model, effort, execution_mode, allowed/forbidden files, constraints, and expected_output. " +
        "Call list_templates first if you don't know the template name. " +
        "Fall back to create_handoff only when no template fits or you need full envelope control.",
      inputSchema: {
        template: z.string().min(1),
        task: z.string().min(1),
        task_title: z.string().min(1).optional(),
        overrides: z
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
          .strict()
          .optional(),
        auto_spawn: z.boolean().default(false),
        audit_metadata: AuditMetadataInput.optional(),
      },
    },
    async (args) => {
      const result = await createHandoffFromTemplate(args, { layout, audit });
      return jsonResult(result);
    },
  );

  const renderInputShape = {
    handoff_id: z.string().optional(),
    inline: HandoffInput.optional(),
  } as const;

  server.registerTool(
    "render_claude_prompt",
    {
      title: "Render Claude prompt",
      description:
        "Render the target-agent prompt and suggested `claude -p` argv for an existing or inline handoff. " +
        "Logs `rendered_claude_prompt` when given a stored handoff_id.",
      inputSchema: renderInputShape,
    },
    async (args) => {
      const result = await renderClaudePrompt(args, { layout, audit });
      return jsonResult(result);
    },
  );

  server.registerTool(
    "render_codex_prompt",
    {
      title: "Render Codex prompt",
      description:
        "Render the target-agent prompt and suggested `codex exec` argv for an existing or inline handoff. " +
        "Logs `rendered_codex_prompt` when given a stored handoff_id.",
      inputSchema: renderInputShape,
    },
    async (args) => {
      const result = await renderCodexPrompt(args, { layout, audit });
      return jsonResult(result);
    },
  );

  server.registerTool(
    "write_audit_log",
    {
      title: "Write audit log entry",
      description:
        "Append a custom audit event to an existing handoff. Use this from the source agent to record " +
        "manual progress (e.g., 'launched_target_manually', 'patch_applied', 'reviewed').",
      inputSchema: {
        handoff_id: z.string().min(1),
        event_label: z.string().min(1),
        detail: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async (args) => {
      const result = await writeAuditLog(args, { layout, audit });
      return jsonResult(result);
    },
  );

  server.registerTool(
    "list_handoffs",
    {
      title: "List handoffs",
      description:
        "List handoff envelopes (newest first), optionally filtered by source/target/status. Default limit 20.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional(),
        source_agent: AgentName.optional(),
        target_agent: AgentName.optional(),
        status: z.string().optional(),
      },
    },
    async (args) => {
      const result = await listHandoffs(args, { layout });
      return jsonResult(result);
    },
  );

  server.registerTool(
    "read_handoff",
    {
      title: "Read handoff",
      description: "Return the full envelope and matching audit events for a handoff id.",
      inputSchema: { handoff_id: z.string().min(1) },
    },
    async (args) => {
      const result = await readHandoff(args, { layout, audit });
      return jsonResult(result);
    },
  );

  server.registerTool(
    "read_latest_handoff",
    {
      title: "Read latest open handoff",
      description:
        "Discover the most recent open handoff assigned to a target agent — the normal way " +
        "Codex finds out what it was asked to do. Pass assigned_to: \"codex\" (or \"claude\") " +
        "to filter; omit to inspect any open handoff. \"Open\" means status is recorded or " +
        "spawning (not yet completed or failed). Returns { envelope, events }, or " +
        "{ envelope: null, events: [] } when nothing matches — safe to poll.",
      inputSchema: { assigned_to: AgentName.optional() },
    },
    async (args) => {
      const result = await readLatestHandoff(args, { layout, audit });
      return jsonResult(result);
    },
  );

  return { server, layout };
}

async function main() {
  const { server } = await buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isDirectInvocation =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("/dist/index.js") === true ||
  process.argv[1]?.endsWith("relayos-mcp") === true;

if (isDirectInvocation) {
  main().catch((err) => {
    process.stderr.write(`[relayos-mcp] fatal: ${err?.stack ?? err}\n`);
    process.exit(1);
  });
}
