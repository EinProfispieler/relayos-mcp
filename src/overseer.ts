import { existsSync, readFileSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface OverseerLayout {
  dir: string;
  timelinePath: string;
  decisionsPath: string;
  handoffResultsPath: string;
  nextActionPath: string;
}

export function resolveOverseerLayout(cwd: string): OverseerLayout {
  const dir = join(cwd, ".relayos", "overseer");
  return {
    dir,
    timelinePath: join(dir, "timeline.jsonl"),
    decisionsPath: join(dir, "decisions.jsonl"),
    handoffResultsPath: join(dir, "handoff_results.jsonl"),
    nextActionPath: join(dir, "next_action.md"),
  };
}

export async function ensureOverseerDir(layout: OverseerLayout): Promise<void> {
  await mkdir(layout.dir, { recursive: true });
}

export interface OverseerNote {
  ts: string;
  text: string;
}

export interface OverseerDecision {
  ts: string;
  text: string;
}

export type OverseerHandoffResultStatus =
  | "completed"
  | "failed"
  | "blocked"
  | "needs_review";

export interface OverseerHandoffResult {
  ts: string;
  run_id: string;
  status: OverseerHandoffResultStatus;
  summary: string;
  tests_run?: string[];
  test_result?: string;
  blockers?: string[];
  needs_review?: boolean;
  requires_user_approval?: boolean;
}

export async function appendNote(layout: OverseerLayout, text: string): Promise<void> {
  await ensureOverseerDir(layout);
  const entry: OverseerNote = { ts: new Date().toISOString(), text };
  await appendFile(layout.timelinePath, `${JSON.stringify(entry)}\n`, "utf8");
}

export async function readLatestNotes(
  layout: OverseerLayout,
  limit = 5,
): Promise<OverseerNote[]> {
  if (!existsSync(layout.timelinePath)) return [];
  const raw = await readFile(layout.timelinePath, "utf8");
  const notes: OverseerNote[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      notes.push(JSON.parse(line) as OverseerNote);
    } catch {
      // skip malformed lines
    }
  }
  return notes.slice(-limit);
}

export async function appendDecision(layout: OverseerLayout, text: string): Promise<void> {
  await ensureOverseerDir(layout);
  const entry: OverseerDecision = { ts: new Date().toISOString(), text };
  await appendFile(layout.decisionsPath, `${JSON.stringify(entry)}\n`, "utf8");
}

export async function readLatestDecisions(
  layout: OverseerLayout,
  limit = 8,
): Promise<OverseerDecision[]> {
  if (!existsSync(layout.decisionsPath)) return [];
  const raw = await readFile(layout.decisionsPath, "utf8");
  const decisions: OverseerDecision[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      decisions.push(JSON.parse(line) as OverseerDecision);
    } catch {
      // skip malformed lines
    }
  }
  return decisions.slice(-limit);
}

export async function appendHandoffResult(
  layout: OverseerLayout,
  input: Omit<OverseerHandoffResult, "ts">,
): Promise<void> {
  await ensureOverseerDir(layout);
  const entry: OverseerHandoffResult = {
    ts: new Date().toISOString(),
    run_id: input.run_id,
    status: input.status,
    summary: input.summary,
    tests_run: input.tests_run,
    test_result: input.test_result,
    blockers: input.blockers,
    needs_review: input.needs_review,
    requires_user_approval: input.requires_user_approval,
  };
  await appendFile(layout.handoffResultsPath, `${JSON.stringify(entry)}\n`, "utf8");
}

export async function readLatestHandoffResults(
  layout: OverseerLayout,
  limit = 8,
): Promise<OverseerHandoffResult[]> {
  if (!existsSync(layout.handoffResultsPath)) return [];
  const raw = await readFile(layout.handoffResultsPath, "utf8");
  const results: OverseerHandoffResult[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      results.push(JSON.parse(line) as OverseerHandoffResult);
    } catch {
      // skip malformed lines
    }
  }
  return results.slice(-limit);
}

export async function readHandoffResultsByRunId(
  layout: OverseerLayout,
  runId: string,
): Promise<OverseerHandoffResult[]> {
  if (!existsSync(layout.handoffResultsPath)) return [];
  const raw = await readFile(layout.handoffResultsPath, "utf8");
  const results: OverseerHandoffResult[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(line) as OverseerHandoffResult;
      if (parsed.run_id === runId) results.push(parsed);
    } catch {
      // skip malformed lines
    }
  }
  return results;
}

export async function writeNextAction(layout: OverseerLayout, text: string): Promise<void> {
  await ensureOverseerDir(layout);
  await writeFile(layout.nextActionPath, `${text}\n`, "utf8");
}

export async function readNextAction(layout: OverseerLayout): Promise<string | null> {
  if (!existsSync(layout.nextActionPath)) return null;
  const content = await readFile(layout.nextActionPath, "utf8");
  const trimmed = content.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function hasOverseerState(layout: OverseerLayout): boolean {
  return existsSync(layout.timelinePath) || existsSync(layout.nextActionPath);
}

export const OVERSEER_CONTEXT_CANONICAL_FILES = [
  "PROJECT_BRIEF.md",
  "CURRENT_STATE.md",
  "OPERATING_POLICY.md",
  "NEXT_ACTION.md",
  "FORBIDDEN_ACTIONS.md",
  "MODEL_POLICY.md",
  "timeline.jsonl",
] as const;

export interface OverseerContextFileStatus {
  name: string;
  exists: boolean;
}

export interface OverseerContextSnapshot {
  ok: boolean;
  workspace_path: string;
  files: OverseerContextFileStatus[];
  missing: string[];
  gitignored: boolean | null;
}

export interface OverseerHandshakeSnapshot {
  ok: boolean;
  protocol: "relayos-overseer-session-v1";
  session_role: "overseer_client";
  repo_path: string;
  workspace_path: string;
  context_complete: boolean;
  files: OverseerContextFileStatus[];
  missing: string[];
  must_read: string[];
  next_action_source: string;
  forbidden_actions: string[];
  requires_explicit_user_approval_for: string[];
  notes: string[];
}

export interface OverseerContextPackNote {
  ts: string;
  text: string;
}

export interface OverseerContextPack {
  ok: boolean;
  protocol: "relayos-overseer-session-v1";
  tool: "read_overseer_context_pack";
  context_complete: boolean;
  missing: string[];
  workspace_path: string;
  project_summary: string | null;
  current_state: string | null;
  next_action: string | null;
  recent_notes: OverseerContextPackNote[];
  notes_count: number;
  recent_decisions: OverseerDecision[];
  decisions_count: number;
  recent_handoff_results: OverseerHandoffResult[];
  handoff_results_count: number;
  limit: number;
  forbidden_actions: string[];
  model_policy: string | null;
  recommended_prompt: string;
  evidence_links: string[];
  notes: string[];
}

export interface OverseerRunPreflightCheck {
  name:
    | "context_complete"
    | "has_next_action"
    | "has_current_state"
    | "has_model_policy"
    | "has_forbidden_actions";
  status: "pass" | "warn";
  detail: string;
}

export interface OverseerRunPreflight {
  ok: boolean;
  tool: "run-preflight";
  workspace_path: string;
  context_complete: boolean;
  missing: string[];
  checks: OverseerRunPreflightCheck[];
  recent_notes_count: number;
  runtime_active: false;
  runner_active: false;
  queue_active: false;
  ready_for_future_run: boolean;
  notes: string[];
}

export interface OverseerCapabilities {
  ok: boolean;
  tool: "read_overseer_capabilities";
  workspace_path: string;
  capability_policy_version: "2026-05-15.static-v1";
  allowed_by_default: string[];
  requires_explicit_approval: string[];
  forbidden: string[];
  detected_surfaces: string[];
  notes: string[];
}

export interface OverseerRoleProfile {
  role: {
    name: "RelayOS Overseer";
    description: "high-reasoning human-facing supervisory/control role";
    recommended_model: "GPT-5.5 Thinking or equivalent";
    recommended_effort: "medium_or_high";
  };
  activation_phrases: string[];
  startup_sequence: string[];
  delegation_policy: string[];
  reporting_style: {
    requirements: string[];
    status_markers: string[];
    default_sections: string[];
    rules: string[];
  };
  safety_policy: string[];
}

export interface OverseerSummary {
  ok: boolean;
  protocol: "relayos-overseer-session-v1";
  tool: "read_overseer_summary";
  workspace_path: string;
  context_complete: boolean;
  missing: string[];
  project_summary: string | null;
  current_state: string | null;
  next_action: string | null;
  recent_notes: OverseerContextPackNote[];
  notes_count: number;
  recent_decisions: OverseerDecision[];
  decisions_count: number;
  recent_handoff_results: OverseerHandoffResult[];
  handoff_results_count: number;
  run_preflight: OverseerRunPreflight;
  recommended_next_action_prompt: string;
  evidence_links: string[];
  limit: number;
  notes: string[];
}

export interface OverseerDoctorCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface OverseerDoctor {
  ok: boolean;
  tool: "overseer-doctor";
  workspace_path: string;
  version: string;
  context_complete: boolean;
  missing: string[];
  recent_notes_count: number;
  recent_decisions_count: number;
  recent_handoff_results_count: number;
  handoff_results_available: boolean;
  run_preflight_ready: boolean;
  tracked_local_state_files: string[];
  stale_build_possible: boolean;
  checks: OverseerDoctorCheck[];
  recommended_next_action:
    | "ready"
    | "run npm run build"
    | "initialize/fix local overseer context"
    | "inspect missing files";
  notes: string[];
}

export type OverseerMemoryIndexCategory =
  | "project_state"
  | "current_version_release_state"
  | "workflow_rules"
  | "product_decisions"
  | "implementation_notes"
  | "handoff_results"
  | "blockers"
  | "environment_recovery_policy"
  | "capability_policy"
  | "docs_backlog"
  | "next_actions"
  | "forbidden_actions";

export interface OverseerMemoryIndexItem {
  source: string;
  priority: number;
  ts: string | null;
  text: string;
  metadata: Record<string, unknown>;
}

export interface OverseerMemoryIndexStaleness {
  stale_build_possible: boolean;
  release_info_stale: boolean | null;
  note: string;
}

export interface OverseerMemoryIndex {
  ok: boolean;
  tool: "read_overseer_memory_index";
  workspace_path: string;
  memory_index_version: "2026-05-15.live-v1";
  generated_live: true;
  persisted: false;
  current_head: string | null;
  package_version: string | null;
  record_counts: Record<string, number>;
  retrieval_priority: string[];
  categories: Record<OverseerMemoryIndexCategory, OverseerMemoryIndexItem[]>;
  staleness: OverseerMemoryIndexStaleness;
  notes: string[];
}

async function runGitCommand(
  cwd: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolveRun) => {
    execFile("git", args, { cwd, windowsHide: true }, (error, stdout) => {
      if (error) {
        resolveRun({ ok: false, stdout: "" });
        return;
      }
      resolveRun({ ok: true, stdout });
    });
  });
}

function compactOneLine(value: string): string {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length <= 280 ? line : `${line.slice(0, 277)}...`;
}

function pushIndexItem(
  categories: Record<OverseerMemoryIndexCategory, OverseerMemoryIndexItem[]>,
  category: OverseerMemoryIndexCategory,
  item: OverseerMemoryIndexItem,
) {
  categories[category].push(item);
}

function readPackageVersionFromCwd(cwd: string): string | null {
  try {
    const raw = readFileSync(join(cwd, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.length > 0 ? parsed.version : null;
  } catch {
    return null;
  }
}

async function listTrackedOverseerStateFiles(cwd: string): Promise<string[]> {
  const result = await runGitCommand(cwd, ["ls-files", "--", ".relayos/overseer"]);
  if (!result.ok) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function detectStaleCliBuild(cwd: string): boolean {
  const srcPath = join(cwd, "src", "cli.ts");
  const distPath = join(cwd, "dist", "cli.js");
  if (!existsSync(srcPath) || !existsSync(distPath)) return true;
  try {
    return statSync(srcPath).mtimeMs > statSync(distPath).mtimeMs;
  } catch {
    return true;
  }
}

async function readGitIgnoredStatus(cwd: string, path: string): Promise<boolean | null> {
  const isRepo = await runGitCommand(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (!isRepo.ok) return null;
  const check = await runGitCommand(cwd, ["check-ignore", "-q", "--", path]);
  return check.ok;
}

export async function readOverseerContextSnapshot(cwd: string): Promise<OverseerContextSnapshot> {
  const workspacePath = join(cwd, ".relayos", "overseer");
  const files = OVERSEER_CONTEXT_CANONICAL_FILES.map((name) => ({
    name,
    exists: existsSync(join(workspacePath, name)),
  }));
  const missing = files.filter((f) => !f.exists).map((f) => f.name);
  const ok = missing.length === 0;
  const gitignored = await readGitIgnoredStatus(cwd, ".relayos/overseer/");
  return {
    ok,
    workspace_path: workspacePath,
    files,
    missing,
    gitignored,
  };
}

export async function readOverseerHandshakeSnapshot(
  cwd: string,
): Promise<OverseerHandshakeSnapshot> {
  const context = await readOverseerContextSnapshot(cwd);
  const workspacePath = context.workspace_path;
  return {
    ok: context.ok,
    protocol: "relayos-overseer-session-v1",
    session_role: "overseer_client",
    repo_path: cwd,
    workspace_path: workspacePath,
    context_complete: context.ok,
    files: context.files,
    missing: context.missing,
    must_read: OVERSEER_CONTEXT_CANONICAL_FILES.map((name) => join(workspacePath, name)),
    next_action_source: join(workspacePath, "NEXT_ACTION.md"),
    forbidden_actions: [
      "No runtime activation/switching or migration.",
      "No daemon/background agent behavior.",
      "No parallel mode, queue runner, or sub-run orchestration.",
      "No storage/envelope/audit format changes.",
    ],
    requires_explicit_user_approval_for: [
      "Tags or releases.",
      "Force push, amend published commits, or --no-verify.",
      "Any write-path beyond approved read-only commands.",
    ],
    notes: [
      "Human-supervised local-first overseer protocol, not a daemon or security sandbox.",
      "Missing context files are reported; this command never creates files.",
    ],
  };
}

export async function readOverseerTextFile(
  layout: OverseerLayout,
  filename: string,
): Promise<string | null> {
  const filePath = join(layout.dir, filename);
  if (!existsSync(filePath)) return null;
  const content = await readFile(filePath, "utf8");
  const trimmed = content.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function compactText(value: string | null): string | null {
  if (!value) return null;
  for (const raw of value.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    return line.length <= 280 ? line : `${line.slice(0, 277)}...`;
  }
  const single = value.replace(/\s+/g, " ").trim();
  if (!single) return null;
  return single.length <= 280 ? single : `${single.slice(0, 277)}...`;
}

function buildRecommendedPrompt(): string {
  return [
    "Call read_overseer_handshake {} and read_overseer_recent {\"limit\":8}, then recommend exactly one next safe action.",
    "If handshake ok/context_complete is false, report missing files and wait for explicit user approval before any edits.",
    "Do not edit files until the user approves a scoped task.",
  ].join(" ");
}

function buildEvidenceLinks(cwd: string): string[] {
  const base = join(cwd, ".relayos", "overseer");
  return [
    join(base, "PROJECT_BRIEF.md"),
    join(base, "CURRENT_STATE.md"),
    join(base, "NEXT_ACTION.md"),
    join(base, "FORBIDDEN_ACTIONS.md"),
    join(base, "MODEL_POLICY.md"),
    join(base, "timeline.jsonl"),
    join(cwd, "docs", "ROADMAP.md"),
    join(cwd, "docs", "CURATED_MEMORY.md"),
    join(cwd, "docs", "SCOPED_ROOKIE_RUNTIME.md"),
  ];
}

export async function buildOverseerContextPack(
  cwd: string,
  limit: number,
): Promise<OverseerContextPack> {
  const layout = resolveOverseerLayout(cwd);
  const [
    context,
    handshake,
    projectBriefRaw,
    currentStateRaw,
    nextActionRaw,
    modelPolicyRaw,
    notes,
    decisions,
    handoffResults,
  ] = await Promise.all([
    readOverseerContextSnapshot(cwd),
    readOverseerHandshakeSnapshot(cwd),
    readOverseerTextFile(layout, "PROJECT_BRIEF.md"),
    readOverseerTextFile(layout, "CURRENT_STATE.md"),
    readNextAction(layout),
    readOverseerTextFile(layout, "MODEL_POLICY.md"),
    readLatestNotes(layout, limit),
    readLatestDecisions(layout, limit),
    readLatestHandoffResults(layout, limit),
  ]);

  return {
    ok: context.ok,
    protocol: handshake.protocol,
    tool: "read_overseer_context_pack",
    context_complete: context.ok,
    missing: context.missing,
    workspace_path: context.workspace_path,
    project_summary: compactText(projectBriefRaw),
    current_state: compactText(currentStateRaw),
    next_action: compactText(nextActionRaw),
    recent_notes: notes.map((n) => ({ ts: n.ts, text: n.text })),
    notes_count: notes.length,
    recent_decisions: decisions.map((d) => ({ ts: d.ts, text: d.text })),
    decisions_count: decisions.length,
    recent_handoff_results: handoffResults,
    handoff_results_count: handoffResults.length,
    limit,
    forbidden_actions: handshake.forbidden_actions,
    model_policy: compactText(modelPolicyRaw),
    recommended_prompt: buildRecommendedPrompt(),
    evidence_links: buildEvidenceLinks(cwd),
    notes: [
      "Curated context pack is compact by design; no raw full chat transcript sync.",
      "Read-only tool: does not create, modify, or delete .relayos/overseer files.",
      "Use write_overseer_note after approved tasks to keep local progress timeline current.",
    ],
  };
}

export async function buildOverseerRunPreflight(
  cwd: string,
): Promise<OverseerRunPreflight> {
  const layout = resolveOverseerLayout(cwd);
  const [context, nextAction, currentState, modelPolicy, forbiddenActions, notes] =
    await Promise.all([
      readOverseerContextSnapshot(cwd),
      readOverseerTextFile(layout, "NEXT_ACTION.md"),
      readOverseerTextFile(layout, "CURRENT_STATE.md"),
      readOverseerTextFile(layout, "MODEL_POLICY.md"),
      readOverseerTextFile(layout, "FORBIDDEN_ACTIONS.md"),
      readLatestNotes(layout, 20),
    ]);

  const hasNextAction = Boolean(nextAction);
  const hasCurrentState = Boolean(currentState);
  const hasModelPolicy = Boolean(modelPolicy);
  const hasForbiddenActions = Boolean(forbiddenActions);
  const readyForFutureRun =
    context.ok &&
    hasNextAction &&
    hasCurrentState &&
    hasModelPolicy &&
    hasForbiddenActions;

  const checks: OverseerRunPreflightCheck[] = [
    {
      name: "context_complete",
      status: context.ok ? "pass" : "warn",
      detail: context.ok
        ? "canonical overseer context files are present"
        : "missing canonical overseer files",
    },
    {
      name: "has_next_action",
      status: hasNextAction ? "pass" : "warn",
      detail: hasNextAction
        ? "NEXT_ACTION.md is present and non-empty"
        : "NEXT_ACTION.md is missing or empty",
    },
    {
      name: "has_current_state",
      status: hasCurrentState ? "pass" : "warn",
      detail: hasCurrentState
        ? "CURRENT_STATE.md is present and non-empty"
        : "CURRENT_STATE.md is missing or empty",
    },
    {
      name: "has_model_policy",
      status: hasModelPolicy ? "pass" : "warn",
      detail: hasModelPolicy
        ? "MODEL_POLICY.md is present and non-empty"
        : "MODEL_POLICY.md is missing or empty",
    },
    {
      name: "has_forbidden_actions",
      status: hasForbiddenActions ? "pass" : "warn",
      detail: hasForbiddenActions
        ? "FORBIDDEN_ACTIONS.md is present and non-empty"
        : "FORBIDDEN_ACTIONS.md is missing or empty",
    },
  ];

  return {
    ok: true,
    tool: "run-preflight",
    workspace_path: context.workspace_path,
    context_complete: context.ok,
    missing: context.missing,
    checks,
    recent_notes_count: notes.length,
    runtime_active: false,
    runner_active: false,
    queue_active: false,
    ready_for_future_run: readyForFutureRun,
    notes: [
      "Preflight only: no run was created.",
      "No agent process was started.",
      "Runner/queue/runtime activation are not active in current Core.",
      "High-risk actions still require explicit human approval (commit/push/tag/release/deletion/schema/runtime/provider).",
    ],
  };
}

export async function buildOverseerCapabilities(
  cwd: string,
): Promise<OverseerCapabilities> {
  const layout = resolveOverseerLayout(cwd);
  return {
    ok: true,
    tool: "read_overseer_capabilities",
    workspace_path: layout.dir,
    capability_policy_version: "2026-05-15.static-v1",
    allowed_by_default: [
      "Read repository files.",
      "Read RelayOS context, summary, doctor, preflight, and capability surfaces.",
      "Write overseer notes, decisions, and handoff results only after approved scoped work.",
      "Use known RelayOS MCP read surfaces for local continuity recovery.",
    ],
    requires_explicit_approval: [
      "Edit scoped files.",
      "Run build/tests if not already part of the approved task.",
      "Install or update packages.",
      "Use network access.",
      "Commit, push, tag, or release.",
      "Run outside a failed sandbox for environment recovery.",
      "Modify shell profiles or global npm, git, proxy, or system configuration.",
    ],
    forbidden: [
      "Runner, queue, daemon, or autonomous runtime activation.",
      "Provider/API/cloud/telemetry integration.",
      "Raw full chat sync.",
      "Secret inspection or exfiltration.",
      "Vector DB or memory index service.",
      "UI, server, account, or billing features.",
      "Storage, envelope, or audit schema changes unless explicitly approved.",
      "Automatic Claude/Codex switching.",
    ],
    detected_surfaces: [
      "CLI: relayos overseer context",
      "CLI: relayos overseer handshake",
      "CLI: relayos overseer recent",
      "CLI: relayos overseer context-pack",
      "CLI: relayos overseer run-preflight",
      "CLI: relayos overseer summary",
      "CLI: relayos overseer doctor",
      "CLI: relayos overseer capabilities",
      "CLI: relayos overseer note",
      "CLI: relayos overseer decision/decisions",
      "CLI: relayos overseer handoff-result/handoff-results",
      "MCP: read_overseer_bootstrap_prompt",
      "MCP: read_overseer_handshake",
      "MCP: read_overseer_context_pack",
      "MCP: read_overseer_run_preflight",
      "MCP: read_overseer_summary",
      "MCP: read_overseer_doctor",
      "MCP: read_overseer_capabilities",
      "MCP: read_overseer_recent",
      "MCP: read_overseer_decisions",
      "MCP: read_handoff_result/read_handoff_results",
      "MCP: write_overseer_note",
      "MCP: write_overseer_decision",
      "MCP: write_handoff_result",
    ],
    notes: [
      "Static read-only capability policy snapshot; no external tool discovery is performed.",
      "No secrets, network services, system settings, runtime activation, runner, queue, daemon, provider, cloud, telemetry, or schema changes are inspected or modified.",
      "This snapshot describes RelayOS overseer/session policy posture before handoff or runtime-adjacent work proceeds.",
    ],
  };
}

export function buildOverseerRoleProfile(): OverseerRoleProfile {
  return {
    role: {
      name: "RelayOS Overseer",
      description: "high-reasoning human-facing supervisory/control role",
      recommended_model: "GPT-5.5 Thinking or equivalent",
      recommended_effort: "medium_or_high",
    },
    activation_phrases: [
      "Overseer mode.",
      "RelayOS Overseer mode.",
      "进入 RelayOS Overseer。",
      "继续作为 RelayOS Overseer。",
    ],
    startup_sequence: [
      "read_overseer_role_profile",
      "read_overseer_doctor",
      "read_overseer_capabilities",
      "read_overseer_memory_index",
      "read_overseer_bootstrap_prompt",
      "read_overseer_handshake",
      "read_overseer_summary",
      "read_overseer_context_pack",
      "read_overseer_recent",
      "read_overseer_decisions",
      "read_handoff_results",
    ],
    delegation_policy: [
      "GPT-5.5 medium/high handles high-level planning, judgment, risk control, approval gates, and final review.",
      "gpt-5.3-codex low handles routine MCP note/readback actions.",
      "gpt-5.3-codex medium handles normal implementation, CLI/MCP parity, tests, and audits.",
      "Claude Sonnet medium handles architecture/docs/readability review.",
      "Overseer should classify each request and delegate operational work when appropriate instead of personally executing every task.",
    ],
    reporting_style: {
      requirements: [
        "user-facing updates must be structured and scannable.",
        "use separate labeled sections.",
        "avoid dense inline prose.",
      ],
      status_markers: [
        "✅ PASS",
        "❌ FAIL",
        "⚠️ WARNING",
        "⚠️ PARTIAL",
        "⏳ RUNNING",
        "🛑 BLOCKED",
        "🔁 RETRYING",
        "🟡 NEEDS APPROVAL",
        "ℹ️ INFO",
      ],
      default_sections: [
        "🎯 Target",
        "🧠 Model / Effort",
        "📌 Task",
        "🔁 Delegation",
        "📂 Files",
        "🧪 Validation",
        "🛠️ CLI / MCP",
        "🧾 Output shape",
        "🛡️ Boundaries",
        "⚠️ Warnings",
        "🛑 Blockers",
        "🟡 Approval needed",
        "📒 Notes / Evidence",
        "➡️ Next",
      ],
      rules: [
        "Use one primary status marker at the top.",
        "Use only relevant sections; do not include empty sections.",
        "Do not compress Target / Model / Effort into one sentence.",
        "Always separate overseer model/effort from delegated worker model/effort.",
        "Use bullets under sections.",
        "Keep each section short.",
        "Use WARNING for caveats that do not block progress.",
        "Use PARTIAL when the task is incomplete or verification is incomplete.",
        "Use BLOCKED only when the task cannot proceed without intervention.",
        "Use NEEDS APPROVAL when the next action requires user approval.",
      ],
    },
    safety_policy: [
      "no edit/commit/push/tag/release without approval",
      "use batch commits",
      "no runner/queue/daemon/autonomous loop/runtime activation",
      "no provider/API/cloud/telemetry/raw chat sync/vector DB/UI/server/account/billing/schema changes unless explicitly approved",
      "proxy/TUN/sandbox failures use fresh retry and manual approval recovery policy",
    ],
  };
}

export function buildOverseerManagedAgentsSection(): string {
  const profile = buildOverseerRoleProfile();
  const lines: string[] = [
    "## RELAYOS-MANAGED OVERSEER INSTRUCTIONS",
    "When any of the following activation phrases appear, enter RelayOS Overseer routing mode immediately:",
    ...profile.activation_phrases.map((phrase) => `- ${phrase}`),
    "",
    "Routing contract:",
    "- first call read_overseer_role_profile {}",
    "- then follow startup_sequence exactly",
    "- do not start repo audits, implementation, or documentation review before role-profile recovery",
    "- do not edit/commit/push/tag/release without explicit approval",
  ];
  return lines.join("\n");
}

export async function buildOverseerSummary(
  cwd: string,
  limit: number,
): Promise<OverseerSummary> {
  const layout = resolveOverseerLayout(cwd);
  const [pack, preflight, handoffResults] = await Promise.all([
    buildOverseerContextPack(cwd, limit),
    buildOverseerRunPreflight(cwd),
    readLatestHandoffResults(layout, limit),
  ]);

  return {
    ok: pack.ok,
    protocol: pack.protocol,
    tool: "read_overseer_summary",
    workspace_path: pack.workspace_path,
    context_complete: pack.context_complete,
    missing: pack.missing,
    project_summary: pack.project_summary,
    current_state: pack.current_state,
    next_action: pack.next_action,
    recent_notes: pack.recent_notes,
    notes_count: pack.notes_count,
    recent_decisions: pack.recent_decisions,
    decisions_count: pack.decisions_count,
    recent_handoff_results: handoffResults,
    handoff_results_count: handoffResults.length,
    run_preflight: preflight,
    recommended_next_action_prompt: pack.recommended_prompt,
    evidence_links: pack.evidence_links,
    limit: pack.limit,
    notes: [
      "Deterministic read-only summary built from local curated state.",
      "No model summarization and no raw full chat transcript sync.",
      "Summary builder does not create, modify, or delete .relayos/overseer files.",
    ],
  };
}

export async function buildOverseerDoctor(cwd: string): Promise<OverseerDoctor> {
  const layout = resolveOverseerLayout(cwd);
  const version = readPackageVersionFromCwd(cwd) ?? "unknown";
  const [context, pack, summary, preflight, trackedFiles] = await Promise.all([
    readOverseerContextSnapshot(cwd),
    buildOverseerContextPack(cwd, 8),
    buildOverseerSummary(cwd, 8),
    buildOverseerRunPreflight(cwd),
    listTrackedOverseerStateFiles(cwd),
  ]);
  const staleBuildPossible = detectStaleCliBuild(cwd);

  const checks: OverseerDoctorCheck[] = [
    {
      name: "package_version_visible",
      status: version === "unknown" ? "warn" : "pass",
      detail:
        version === "unknown"
          ? "Could not read package.json version from current working directory."
          : `package.json version is ${version}.`,
    },
    {
      name: "context_complete",
      status: context.ok ? "pass" : "warn",
      detail: context.ok
        ? "Required local overseer files are present."
        : `Missing required overseer files: ${context.missing.join(", ")}.`,
    },
    {
      name: "context_pack_available",
      status: pack.ok ? "pass" : "warn",
      detail: pack.ok
        ? "Context-pack builder returned deterministic read-only output."
        : "Context-pack builder reported incomplete local context.",
    },
    {
      name: "summary_available",
      status: summary.ok ? "pass" : "warn",
      detail: summary.ok
        ? "Summary builder returned deterministic read-only output."
        : "Summary builder reported incomplete local context.",
    },
    {
      name: "run_preflight_ready",
      status: preflight.ready_for_future_run ? "pass" : "warn",
      detail: preflight.ready_for_future_run
        ? "Run-preflight reports ready_for_future_run=yes."
        : "Run-preflight reports ready_for_future_run=no.",
    },
    {
      name: "tracked_local_state_files",
      status: trackedFiles.length === 0 ? "pass" : "fail",
      detail:
        trackedFiles.length === 0
          ? "No tracked .relayos/overseer files detected."
          : `Tracked .relayos/overseer files detected (${trackedFiles.length}).`,
    },
    {
      name: "dist_cli_freshness",
      status: staleBuildPossible ? "warn" : "pass",
      detail: staleBuildPossible
        ? "dist/cli.js may be stale relative to src/cli.ts (or missing)."
        : "dist/cli.js is not older than src/cli.ts.",
    },
  ];

  let recommendedNextAction: OverseerDoctor["recommended_next_action"] = "ready";
  if (staleBuildPossible) {
    recommendedNextAction = "run npm run build";
  } else if (context.missing.length > 0) {
    recommendedNextAction =
      context.missing.length > 2
        ? "initialize/fix local overseer context"
        : "inspect missing files";
  }

  return {
    ok: checks.every((c) => c.status === "pass"),
    tool: "overseer-doctor",
    workspace_path: layout.dir,
    version,
    context_complete: context.ok,
    missing: context.missing,
    recent_notes_count: summary.notes_count,
    recent_decisions_count: summary.decisions_count,
    recent_handoff_results_count: summary.handoff_results_count,
    handoff_results_available: summary.handoff_results_count > 0,
    run_preflight_ready: preflight.ready_for_future_run,
    tracked_local_state_files: trackedFiles,
    stale_build_possible: staleBuildPossible,
    checks,
    recommended_next_action: recommendedNextAction,
    notes: [
      "Read-only diagnostics only; no overseer files are created or modified.",
      "Uses existing context, context-pack, summary, and run-preflight builders.",
      "No runtime activation, runner, queue, daemon, or provider integration is performed.",
    ],
  };
}

export async function buildOverseerMemoryIndex(
  cwd: string,
  limit = 8,
): Promise<OverseerMemoryIndex> {
  const safeLimit = Number.isInteger(limit) && limit >= 1 && limit <= 20 ? limit : 8;
  const layout = resolveOverseerLayout(cwd);
  const packageVersion = readPackageVersionFromCwd(cwd);
  const [headResult, summary, capabilities, doctor, decisions, handoffResults, notes] =
    await Promise.all([
      runGitCommand(cwd, ["rev-parse", "HEAD"]),
      buildOverseerSummary(cwd, safeLimit),
      buildOverseerCapabilities(cwd),
      buildOverseerDoctor(cwd),
      readLatestDecisions(layout, safeLimit),
      readLatestHandoffResults(layout, safeLimit),
      readLatestNotes(layout, safeLimit),
    ]);

  const docsBacklogSignals: OverseerMemoryIndexItem[] = [];
  for (const path of summary.evidence_links.filter((p) => p.includes("/docs/"))) {
    if (!existsSync(path)) continue;
    const content = readFileSync(path, "utf8").trim();
    if (!content) continue;
    const first = compactText(content) ?? compactOneLine(content);
    docsBacklogSignals.push({
      source: "docs_backlog",
      priority: 6,
      ts: null,
      text: first,
      metadata: { path: path.replace(`${cwd}/`, "") },
    });
  }

  const categories: Record<OverseerMemoryIndexCategory, OverseerMemoryIndexItem[]> = {
    project_state: [],
    current_version_release_state: [],
    workflow_rules: [],
    product_decisions: [],
    implementation_notes: [],
    handoff_results: [],
    blockers: [],
    environment_recovery_policy: [],
    capability_policy: [],
    docs_backlog: [],
    next_actions: [],
    forbidden_actions: [],
  };

  if (summary.project_summary) {
    pushIndexItem(categories, "project_state", {
      source: "summary",
      priority: 2,
      ts: null,
      text: summary.project_summary,
      metadata: { field: "project_summary" },
    });
  }
  if (summary.current_state) {
    pushIndexItem(categories, "project_state", {
      source: "summary",
      priority: 2,
      ts: null,
      text: summary.current_state,
      metadata: { field: "current_state" },
    });
  }
  if (summary.next_action) {
    pushIndexItem(categories, "next_actions", {
      source: "summary",
      priority: 2,
      ts: null,
      text: summary.next_action,
      metadata: { field: "next_action" },
    });
  }

  for (const decision of decisions) {
    pushIndexItem(categories, "product_decisions", {
      source: "decisions",
      priority: 1,
      ts: decision.ts,
      text: compactOneLine(decision.text),
      metadata: {},
    });
  }

  for (const result of handoffResults) {
    pushIndexItem(categories, "handoff_results", {
      source: "handoff_results",
      priority: 3,
      ts: result.ts,
      text: `${result.run_id} ${result.status}: ${compactOneLine(result.summary)}`,
      metadata: { run_id: result.run_id, status: result.status },
    });
    if (
      result.status === "blocked" ||
      result.status === "failed" ||
      result.status === "needs_review"
    ) {
      pushIndexItem(categories, "blockers", {
        source: "handoff_results",
        priority: 3,
        ts: result.ts,
        text: `${result.run_id} ${result.status}: ${compactOneLine(result.summary)}`,
        metadata: {
          run_id: result.run_id,
          status: result.status,
          blockers: result.blockers ?? [],
        },
      });
    }
  }

  for (const note of notes) {
    pushIndexItem(categories, "implementation_notes", {
      source: "recent_notes",
      priority: 5,
      ts: note.ts,
      text: compactOneLine(note.text),
      metadata: {},
    });
  }

  for (const item of capabilities.requires_explicit_approval) {
    pushIndexItem(categories, "workflow_rules", {
      source: "capabilities",
      priority: 4,
      ts: null,
      text: item,
      metadata: { approval: true },
    });
  }
  for (const item of capabilities.forbidden) {
    pushIndexItem(categories, "forbidden_actions", {
      source: "capabilities",
      priority: 4,
      ts: null,
      text: item,
      metadata: {},
    });
  }
  for (const item of capabilities.allowed_by_default) {
    pushIndexItem(categories, "capability_policy", {
      source: "capabilities",
      priority: 4,
      ts: null,
      text: item,
      metadata: {},
    });
  }

  pushIndexItem(categories, "environment_recovery_policy", {
    source: "doctor",
    priority: 4,
    ts: null,
    text: `recommended_next_action=${doctor.recommended_next_action}`,
    metadata: { stale_build_possible: doctor.stale_build_possible },
  });
  pushIndexItem(categories, "current_version_release_state", {
    source: "doctor",
    priority: 4,
    ts: null,
    text: `package_version=${packageVersion ?? "unknown"} current_head=${headResult.ok ? headResult.stdout.trim() : "unknown"}`,
    metadata: {
      package_version: packageVersion,
      current_head: headResult.ok ? headResult.stdout.trim() : null,
    },
  });

  for (const item of docsBacklogSignals) {
    pushIndexItem(categories, "docs_backlog", item);
  }

  return {
    ok: true,
    tool: "read_overseer_memory_index",
    workspace_path: layout.dir,
    memory_index_version: "2026-05-15.live-v1",
    generated_live: true,
    persisted: false,
    current_head: headResult.ok ? headResult.stdout.trim() : null,
    package_version: packageVersion,
    record_counts: {
      decisions: decisions.length,
      summary: [summary.project_summary, summary.current_state, summary.next_action].filter(Boolean)
        .length,
      handoff_results: handoffResults.length,
      capabilities_doctor: capabilities.allowed_by_default.length + capabilities.forbidden.length + 1,
      recent_notes: notes.length,
      docs_backlog: docsBacklogSignals.length,
      total: Object.values(categories).reduce((acc, list) => acc + list.length, 0),
    },
    retrieval_priority: [
      "decisions",
      "summary",
      "handoff_results",
      "capabilities/doctor",
      "recent_notes",
      "docs_backlog",
    ],
    categories,
    staleness: {
      stale_build_possible: doctor.stale_build_possible,
      release_info_stale: null,
      note: "release/version staleness is only flagged when deterministic local evidence exists; otherwise null",
    },
    notes: [
      "Read-only live generated memory index built from curated local sources only.",
      "No raw full chat history sync and no private raw conversation storage.",
      "No persistent index file, vector DB, embeddings, runtime/runner/queue/provider/cloud/telemetry, or schema changes.",
    ],
  };
}

// Branch / progress helpers

export interface BranchPaths {
  briefPath: string;
  progressPath: string;
  dir: string;
}

export function resolveBranchPaths(layout: OverseerLayout): BranchPaths {
  const dir = join(layout.dir, "branches", "active");
  return {
    dir,
    briefPath: join(dir, "brief.md"),
    progressPath: join(dir, "progress.md"),
  };
}

export async function writeActiveBrief(
  layout: OverseerLayout,
  name: string,
): Promise<void> {
  const { dir, briefPath } = resolveBranchPaths(layout);
  await mkdir(dir, { recursive: true });
  await writeFile(briefPath, `${name}\n`, "utf8");
}

export async function readActiveBrief(
  layout: OverseerLayout,
): Promise<string | null> {
  const { briefPath } = resolveBranchPaths(layout);
  if (!existsSync(briefPath)) return null;
  const content = await readFile(briefPath, "utf8");
  const trimmed = content.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function appendBranchProgress(
  layout: OverseerLayout,
  text: string,
): Promise<void> {
  const { dir, progressPath } = resolveBranchPaths(layout);
  await mkdir(dir, { recursive: true });
  const entry = `[${new Date().toISOString()}] ${text}`;
  await appendFile(progressPath, `${entry}\n`, "utf8");
}

export async function readBranchProgress(
  layout: OverseerLayout,
): Promise<string | null> {
  const { progressPath } = resolveBranchPaths(layout);
  if (!existsSync(progressPath)) return null;
  const content = await readFile(progressPath, "utf8");
  const trimmed = content.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// init-context stub content

const STUB_CONTENTS: Record<string, string> = {
  "project_brief.md": "# Project Brief\n\n(fill in: what the project is and its Core/Solo direction)\n",
  "current.md": "# Current State\n\nAs of (date):\n\n## Latest commit anchor\n\n`(hash)` — (message)\n\n## Completed features\n\n- (list)\n\n## In progress / pending\n\n(none)\n",
  "release_policy.md": "# Release Policy\n\nNormal workflow: commit + push only. No tag or GitHub Release unless explicitly instructed.\n",
  "forbidden_actions.md": "# Forbidden Actions\n\n1. No git tag.\n2. No GitHub Release.\n3. No committing .relayos/overseer/ files.\n4. No force-push to main.\n5. No amending published commits.\n6. No skipping hooks (--no-verify).\n",
  "product_direction.md": "# Product Direction\n\n## Guiding principle\n\n(fill in)\n\n## Near-term\n\n| Feature | Status |\n|---|---|\n| (feature) | (status) |\n\n## Future (out of scope for OSS core)\n\n- (list)\n",
  "branches/active/brief.md": "# Active Branch\n\n(fill in: current task or branch name)\n",
  "branches/active/progress.md": "",
  "planned/enterprise_server.md": "# Planned: Enterprise Server\n\nRequires a server component. Out of scope for OSS core. No timeline set.\n",
  "planned/web_panel.md": "# Planned: Web Panel / Dashboard\n\nRequires a server component. Out of scope for OSS core. No timeline set.\n",
};

export async function initContextFiles(layout: OverseerLayout): Promise<string[]> {
  const created: string[] = [];
  for (const [relPath, stub] of Object.entries(STUB_CONTENTS)) {
    const fullPath = join(layout.dir, relPath);
    if (existsSync(fullPath)) continue;
    await mkdir(join(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, stub, "utf8");
    created.push(relPath);
  }
  return created;
}
