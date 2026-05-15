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
  createQuickHandoff,
  QuickMode,
} from "./tools/create_quick_handoff.js";
import {
  renderClaudePrompt,
  renderCodexPrompt,
} from "./tools/render_prompts.js";
import { writeAuditLog } from "./tools/write_audit_log.js";
import { listHandoffs } from "./tools/list_handoffs.js";
import { readHandoff } from "./tools/read_handoff.js";
import { readLatestHandoff } from "./tools/read_latest_handoff.js";
import { readOverseerHandshake } from "./tools/read_overseer_handshake.js";
import { readOverseerBootstrapPrompt } from "./tools/read_overseer_bootstrap_prompt.js";
import { readOverseerContextPack } from "./tools/read_overseer_context_pack.js";
import { readOverseerDecisions } from "./tools/read_overseer_decisions.js";
import { readOverseerRecent } from "./tools/read_overseer_recent.js";
import { readOverseerRunPreflight } from "./tools/read_overseer_run_preflight.js";
import { writeOverseerDecision } from "./tools/write_overseer_decision.js";
import { writeOverseerNote } from "./tools/write_overseer_note.js";
import { inspectConfig } from "./tools/inspect_config.js";
import { doctor } from "./tools/doctor.js";
import { listOpenHandoffs } from "./tools/list_open_handoffs.js";
import { SERVER_VERSION } from "./version.js";

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
    { name: "relayos-mcp", version: SERVER_VERSION },
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
        "Delegate work using a named template plus a short task — pick this when you know the " +
        "template name or need to pass `overrides` (allowed_files, effort, expected_output, etc.). " +
        "Templates: codex-patch, codex-review, codex-test, codex-plan, claude-review, claude-plan; " +
        "the server fills model, effort, execution_mode, allowed/forbidden files, constraints, and expected_output. " +
        "For one-shot \"just ask Codex to fix X\" delegation without thinking about template names, " +
        "prefer `create_quick_handoff`. Call `list_templates` first if the template name isn't obvious. " +
        "Fall back to `create_handoff` only when no template fits or you need full envelope control.",
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

  server.registerTool(
    "create_quick_handoff",
    {
      title: "Create quick handoff",
      description:
        "One-shot delegation: pass target_agent + a sentence, get a recorded handoff. " +
        "Use when the user says 'just ask Codex to fix X' or 'have Claude review Y' and " +
        "you don't want to think about template names. " +
        "Maps (target_agent, mode) to a built-in template (codex defaults to patch, " +
        "claude defaults to plan; modes: patch, review, test, plan). " +
        "Optional allowed_files / forbidden_files / constraints flow through as overrides. " +
        "Throws quick_handoff_no_template for unmapped combinations like " +
        "claude+patch — fall back to create_handoff_from_template (project template) " +
        "or create_handoff (full envelope) in that case.",
      inputSchema: {
        target_agent: AgentName,
        task: z.string().min(1),
        mode: QuickMode.optional(),
        allowed_files: z.array(z.string()).optional(),
        forbidden_files: z.array(z.string()).optional(),
        constraints: z.array(z.string()).optional(),
        task_title: z.string().min(1).optional(),
        auto_spawn: z.boolean().default(false),
        audit_metadata: AuditMetadataInput.optional(),
      },
    },
    async (args) => {
      const result = await createQuickHandoff(args, { layout, audit });
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
        "Browse handoff history. Returns full envelopes (newest first) and supports filtering by " +
        "source/target/status — including `completed` and `failed`. Default limit 20. " +
        "For just what is currently queued (status `recorded` or `spawning`) prefer " +
        "`list_open_handoffs`, which returns lightweight summaries instead of full envelopes.",
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

  server.registerTool(
    "read_overseer_handshake",
    {
      title: "Read overseer handshake",
      description:
        "Read-only overseer session handshake snapshot for MCP clients. Returns protocol/session role, " +
        "repo/workspace paths, canonical context file availability, must-read file paths, next-action source, " +
        "and safety reminders. No files are created or modified.",
      inputSchema: {},
    },
    async (args) => {
      const result = await readOverseerHandshake(args);
      return jsonResult(result);
    },
  );

  server.registerTool(
    "read_overseer_bootstrap_prompt",
    {
      title: "Read overseer bootstrap prompt",
      description:
        "Read-only startup prompt for overseer-bound MCP sessions. Returns a ready-to-use protocol " +
        "bootstrap instruction block plus recommended first calls (handshake, then recent). " +
        "No files are created or modified.",
      inputSchema: {},
    },
    async (args) => {
      const result = await readOverseerBootstrapPrompt(args);
      return jsonResult(result);
    },
  );

  server.registerTool(
    "read_overseer_context_pack",
    {
      title: "Read overseer context pack",
      description:
        "Read-only curated overseer context pack for MCP clients. Returns compact project summary, current state, " +
        "next action, bounded recent notes, boundaries, evidence links, and a recommended safe startup prompt. " +
        "No files are created or modified.",
      inputSchema: {
        limit: z.number().int().min(1).max(20).optional(),
      },
    },
    async (args) => {
      const result = await readOverseerContextPack(args);
      return jsonResult(result);
    },
  );

  server.registerTool(
    "read_overseer_run_preflight",
    {
      title: "Read overseer run preflight",
      description:
        "Read-only future-run readiness preflight for scoped Rookie/handoff workflows. " +
        "Returns context completeness, prerequisite checks, readiness status, and safety reminders. " +
        "Preflight only: no run is created and no agent is started.",
      inputSchema: {},
    },
    async (args) => {
      const result = await readOverseerRunPreflight(args);
      return jsonResult(result);
    },
  );

  server.registerTool(
    "write_overseer_decision",
    {
      title: "Write overseer decision",
      description:
        "Append a local overseer decision record to .relayos/overseer/decisions.jsonl for curated continuity. " +
        "Local-only. Creates .relayos/overseer/ if needed. Rejects empty/whitespace decision text.",
      inputSchema: {
        text: z.string().min(1),
      },
    },
    async (args) => {
      const result = await writeOverseerDecision(args);
      return jsonResult(result);
    },
  );

  server.registerTool(
    "read_overseer_decisions",
    {
      title: "Read overseer decisions",
      description:
        "Read-only local overseer decision records for curated continuity. Returns latest bounded decisions " +
        "from .relayos/overseer/decisions.jsonl. Local-only. Never creates files.",
      inputSchema: {
        limit: z.number().int().min(1).max(20).optional(),
      },
    },
    async (args) => {
      const result = await readOverseerDecisions(args);
      return jsonResult(result);
    },
  );

  server.registerTool(
    "write_overseer_note",
    {
      title: "Write overseer note",
      description:
        "Append a local overseer note to .relayos/overseer/timeline.jsonl for session progress tracking. " +
        "Local-only. Creates .relayos/overseer/ if needed. Rejects empty/whitespace note text.",
      inputSchema: {
        text: z.string().min(1),
      },
    },
    async (args) => {
      const result = await writeOverseerNote(args);
      return jsonResult(result);
    },
  );

  server.registerTool(
    "read_overseer_recent",
    {
      title: "Read overseer recent",
      description:
        "Read-only compact overseer session readback for MCP clients: context completeness, missing files, " +
        "next action, compact current state, and latest timeline notes. Local-only. Never creates files.",
      inputSchema: {
        limit: z.number().int().min(1).max(20).optional(),
      },
    },
    async (args) => {
      const result = await readOverseerRecent(args);
      return jsonResult(result);
    },
  );

  server.registerTool(
    "inspect_config",
    {
      title: "Inspect RelayOS effective config",
      description:
        "Show what RelayOS is actually using for config — call when the wrong template, storage path, " +
        "or shadowed built-in seems to be in effect. Read-only. Returns where the config came from " +
        "(`explicit-env` / `upward-search` / `default`), the resolved storage directory, built-in vs " +
        "project templates (with any project templates shadowing built-ins flagged), and the parsed " +
        "config object. For a broader health check across templates, storage, and version " +
        "consistency, run `doctor` instead. On malformed/invalid config returns a structured " +
        "`{ status: \"error\", error: { type, message, path? } }` result instead of throwing — safe " +
        "to call when something is broken.",
      inputSchema: {},
    },
    async () => {
      const result = inspectConfig({});
      return jsonResult(result);
    },
  );

  server.registerTool(
    "doctor",
    {
      title: "RelayOS doctor",
      description:
        "Run when RelayOS seems broken or before a release: a one-shot read-only health check across " +
        "config, storage, templates, list_handoffs, read_latest_handoff shape, and package/server " +
        "version consistency. Returns `{ status: \"pass\"|\"warn\"|\"fail\", server_version, " +
        "checks: [...] }`; overall status is the worst of any individual check. For just the " +
        "effective config (not a health check) call `inspect_config` instead. Never throws on " +
        "broken state — failures are reported as `fail` checks with `detail`.",
      inputSchema: {
        package_version: z.string().min(1).optional(),
      },
    },
    async (args) => {
      const result = await doctor(args, { layout, audit });
      return jsonResult(result);
    },
  );

  server.registerTool(
    "list_open_handoffs",
    {
      title: "List open handoffs",
      description:
        "What is queued right now. Returns lightweight summaries of open handoffs (status " +
        "`recorded` or `spawning`) — never the full envelope, so it is safe to call without " +
        "spilling task descriptions into context. Each summary: `id`, `title`, `assigned_to`, " +
        "`status`, `created_at`, `tags`, `path`. For full envelopes, history (including " +
        "`completed`/`failed`), or filtering by source agent, use `list_handoffs` instead. " +
        "Optional `assigned_to` filters by target agent (string — accepts `\"codex\"`, " +
        "`\"claude\"`, or any other agent name). Optional `limit` (1–200, default 20).",
      inputSchema: {
        assigned_to: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async (args) => {
      const result = await listOpenHandoffs(args, { layout });
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
