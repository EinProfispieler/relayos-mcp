import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface OverseerLayout {
  dir: string;
  timelinePath: string;
  decisionsPath: string;
  nextActionPath: string;
}

export function resolveOverseerLayout(cwd: string): OverseerLayout {
  const dir = join(cwd, ".relayos", "overseer");
  return {
    dir,
    timelinePath: join(dir, "timeline.jsonl"),
    decisionsPath: join(dir, "decisions.jsonl"),
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
  run_preflight: OverseerRunPreflight;
  recommended_next_action_prompt: string;
  evidence_links: string[];
  limit: number;
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
  ] = await Promise.all([
    readOverseerContextSnapshot(cwd),
    readOverseerHandshakeSnapshot(cwd),
    readOverseerTextFile(layout, "PROJECT_BRIEF.md"),
    readOverseerTextFile(layout, "CURRENT_STATE.md"),
    readNextAction(layout),
    readOverseerTextFile(layout, "MODEL_POLICY.md"),
    readLatestNotes(layout, limit),
    readLatestDecisions(layout, limit),
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

export async function buildOverseerSummary(
  cwd: string,
  limit: number,
): Promise<OverseerSummary> {
  const [pack, preflight] = await Promise.all([
    buildOverseerContextPack(cwd, limit),
    buildOverseerRunPreflight(cwd),
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
