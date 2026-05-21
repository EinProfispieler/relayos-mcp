/**
 * Run Ledger / Continuity Layer — storage helpers.
 *
 * Implements Plan Task 4 (Run Ledger / Continuity Layer plan,
 * docs/superpowers/plans/2026-05-20-run-ledger-continuity-layer.md).
 *
 * Layout: `<cwd>/.relayos/overseer/runs/<r_ULID>/{run.json,
 * task_ledger.jsonl, continuation.json, source_index.jsonl,
 * WORKSPACES.jsonl}` plus `<cwd>/.relayos/overseer/active_run.json`
 * as the pointer to the currently active run.
 *
 * Append-only JSONL files are deduplicated last-write-wins on read by
 * their primary key (seq, path, id). Compact JSON files (run.json,
 * continuation.json, active_run.json) are replaced atomically via
 * write-to-tmp + rename.
 *
 * All read helpers tolerate missing files / missing directories and
 * return empty/null defaults — empty-state behavior is part of the
 * contract.
 *
 * This module is storage-only. CLI subcommands and MCP tools are
 * intentionally NOT in this batch — they land after these helpers are
 * reviewed.
 */
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ContinuationPacket as ContinuationPacketSchema,
  DraftReply as DraftReplySchema,
  ExecutionWorkspace as ExecutionWorkspaceSchema,
  RepairAttempt as RepairAttemptSchema,
  RepairPolicyDecision as RepairPolicyDecisionSchema,
  ReviewFinding as ReviewFindingSchema,
  ReviewLoopEvent as ReviewLoopEventSchema,
  RunRecord as RunRecordSchema,
  SourceIndexEntry as SourceIndexEntrySchema,
  TaskLedgerEntry as TaskLedgerEntrySchema,
  type BatchReport,
  type ContinuationPacket,
  type DraftReply,
  type ExecutionWorkspace,
  type ExecutionWorkspaceStatus,
  type RepairAttempt,
  type RepairPolicyDecision,
  type ReplySent,
  type Result,
  type ReviewFinding,
  type ReviewLoopEvent,
  type ReviewPass,
  type RunRecord,
  type SourceIndexEntry,
  type TaskLedgerEntry,
  type UserApproval,
} from "./schema.js";

// ── Path resolution ──────────────────────────────────────────────────

export interface RunLayout {
  runDir: string;
  runJson: string;
  taskLedger: string;
  continuation: string;
  sourceIndex: string;
  workspaces: string;
}

export function resolveRunsDir(cwd: string): string {
  return join(cwd, ".relayos", "overseer", "runs");
}

export function resolveActiveRunPath(cwd: string): string {
  return join(cwd, ".relayos", "overseer", "active_run.json");
}

export function resolveRunLayout(cwd: string, runId: string): RunLayout {
  const runDir = join(resolveRunsDir(cwd), runId);
  return {
    runDir,
    runJson: join(runDir, "run.json"),
    taskLedger: join(runDir, "task_ledger.jsonl"),
    continuation: join(runDir, "continuation.json"),
    sourceIndex: join(runDir, "source_index.jsonl"),
    workspaces: join(runDir, "WORKSPACES.jsonl"),
  };
}

// ── Active run pointer ───────────────────────────────────────────────

interface ActiveRunPointer {
  run_id: string;
}

export async function readActiveRunId(cwd: string): Promise<string | null> {
  const path = resolveActiveRunPath(cwd);
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, "utf8");
    const obj = JSON.parse(raw) as ActiveRunPointer;
    if (typeof obj?.run_id === "string" && obj.run_id.length > 0) {
      return obj.run_id;
    }
    return null;
  } catch {
    return null;
  }
}

export async function setActiveRunId(cwd: string, runId: string): Promise<void> {
  const overseerDir = join(cwd, ".relayos", "overseer");
  await mkdir(overseerDir, { recursive: true });
  const target = resolveActiveRunPath(cwd);
  const tmp = `${target}.tmp`;
  await writeFile(tmp, JSON.stringify({ run_id: runId }), "utf8");
  await rename(tmp, target);
}

export async function clearActiveRunId(cwd: string): Promise<void> {
  const path = resolveActiveRunPath(cwd);
  await rm(path, { force: true });
}

// ── RunRecord (one per run, compact JSON, replaced atomically) ───────

async function ensureRunDir(layout: RunLayout): Promise<void> {
  await mkdir(layout.runDir, { recursive: true });
}

export async function writeRunRecord(cwd: string, run: RunRecord): Promise<void> {
  const parsed = RunRecordSchema.parse(run);
  const layout = resolveRunLayout(cwd, parsed.id);
  await ensureRunDir(layout);
  const tmp = `${layout.runJson}.tmp`;
  await writeFile(tmp, JSON.stringify(parsed, null, 2), "utf8");
  await rename(tmp, layout.runJson);
}

export async function readRunRecord(
  cwd: string,
  runId: string,
): Promise<RunRecord | null> {
  const layout = resolveRunLayout(cwd, runId);
  if (!existsSync(layout.runJson)) return null;
  try {
    const raw = await readFile(layout.runJson, "utf8");
    return RunRecordSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * List all runs in `.relayos/overseer/runs/`. Returns empty array when
 * the runs dir is missing or contains no valid run records. Sorted by
 * `started_at` descending (most recent first).
 */
export async function listRuns(cwd: string): Promise<RunRecord[]> {
  const runsDir = resolveRunsDir(cwd);
  if (!existsSync(runsDir)) return [];
  const { readdir } = await import("node:fs/promises");
  let entries: string[] = [];
  try {
    entries = await readdir(runsDir);
  } catch {
    return [];
  }
  const records: RunRecord[] = [];
  for (const name of entries) {
    if (!name.startsWith("r_")) continue;
    const rec = await readRunRecord(cwd, name);
    if (rec) records.push(rec);
  }
  records.sort((a, b) => b.started_at.localeCompare(a.started_at));
  return records;
}

// ── TaskLedgerEntry (append-only JSONL, dedup by seq) ────────────────

export async function appendTaskLedgerEntry(
  cwd: string,
  runId: string,
  entry: TaskLedgerEntry,
): Promise<void> {
  const parsed = TaskLedgerEntrySchema.parse(entry);
  const layout = resolveRunLayout(cwd, runId);
  await ensureRunDir(layout);
  await appendFile(layout.taskLedger, `${JSON.stringify(parsed)}\n`, "utf8");
}

/**
 * Read task ledger entries, deduplicated last-write-wins per `seq`.
 * Returns the most recent `lastN` entries by `seq` ascending. Returns
 * empty array when the ledger is missing or empty.
 */
export async function readTaskLedgerEntries(
  cwd: string,
  runId: string,
  lastN: number,
): Promise<TaskLedgerEntry[]> {
  const layout = resolveRunLayout(cwd, runId);
  if (!existsSync(layout.taskLedger)) return [];
  let raw: string;
  try {
    raw = await readFile(layout.taskLedger, "utf8");
  } catch {
    return [];
  }
  const bySeq = new Map<number, TaskLedgerEntry>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue; // skip malformed lines silently
    }
    const result = TaskLedgerEntrySchema.safeParse(obj);
    if (!result.success) continue;
    const entry = result.data;
    const existing = bySeq.get(entry.seq);
    if (!existing || entry.updated_at >= existing.updated_at) {
      bySeq.set(entry.seq, entry);
    }
  }
  const sorted = Array.from(bySeq.values()).sort((a, b) => a.seq - b.seq);
  return sorted.slice(Math.max(0, sorted.length - lastN));
}

// ── ContinuationPacket (compact JSON, replaced atomically) ───────────

export async function writeContinuationPacket(
  cwd: string,
  runId: string,
  packet: ContinuationPacket,
): Promise<void> {
  const parsed = ContinuationPacketSchema.parse(packet);
  const layout = resolveRunLayout(cwd, runId);
  await ensureRunDir(layout);
  const tmp = `${layout.continuation}.tmp`;
  await writeFile(tmp, JSON.stringify(parsed, null, 2), "utf8");
  await rename(tmp, layout.continuation);
}

export async function readContinuationPacket(
  cwd: string,
  runId: string,
): Promise<ContinuationPacket | null> {
  const layout = resolveRunLayout(cwd, runId);
  if (!existsSync(layout.continuation)) return null;
  try {
    const raw = await readFile(layout.continuation, "utf8");
    return ContinuationPacketSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

// ── SourceIndexEntry (append-only JSONL) ─────────────────────────────

export async function appendSourceIndexEntry(
  cwd: string,
  runId: string,
  entry: SourceIndexEntry,
): Promise<void> {
  const parsed = SourceIndexEntrySchema.parse(entry);
  const layout = resolveRunLayout(cwd, runId);
  await ensureRunDir(layout);
  await appendFile(layout.sourceIndex, `${JSON.stringify(parsed)}\n`, "utf8");
}

/**
 * Read source-index entries in append order. No dedup (the file is a
 * chronological log of file touches). Returns empty array when missing.
 */
export async function readSourceIndexEntries(
  cwd: string,
  runId: string,
): Promise<SourceIndexEntry[]> {
  const layout = resolveRunLayout(cwd, runId);
  if (!existsSync(layout.sourceIndex)) return [];
  let raw: string;
  try {
    raw = await readFile(layout.sourceIndex, "utf8");
  } catch {
    return [];
  }
  const out: SourceIndexEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const result = SourceIndexEntrySchema.safeParse(obj);
    if (result.success) out.push(result.data);
  }
  return out;
}

// ── ExecutionWorkspace (append-only JSONL, dedup by id) ──────────────

export async function appendExecutionWorkspace(
  cwd: string,
  runId: string,
  workspace: ExecutionWorkspace,
): Promise<void> {
  const parsed = ExecutionWorkspaceSchema.parse(workspace);
  const layout = resolveRunLayout(cwd, runId);
  await ensureRunDir(layout);
  await appendFile(layout.workspaces, `${JSON.stringify(parsed)}\n`, "utf8");
}

/**
 * Read workspaces, deduplicated last-write-wins per `id`. Sorted by
 * `created_at` ascending. Returns empty array when missing.
 */
export async function readExecutionWorkspaces(
  cwd: string,
  runId: string,
): Promise<ExecutionWorkspace[]> {
  const layout = resolveRunLayout(cwd, runId);
  if (!existsSync(layout.workspaces)) return [];
  let raw: string;
  try {
    raw = await readFile(layout.workspaces, "utf8");
  } catch {
    return [];
  }
  const byId = new Map<string, ExecutionWorkspace>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const result = ExecutionWorkspaceSchema.safeParse(obj);
    if (!result.success) continue;
    const ws = result.data;
    const existing = byId.get(ws.id);
    if (!existing || ws.updated_at >= existing.updated_at) {
      byId.set(ws.id, ws);
    }
  }
  return Array.from(byId.values()).sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
}

/**
 * Append a status-transition record for an existing workspace. Throws
 * if the workspace id is not present in the registry.
 */
export async function updateExecutionWorkspaceStatus(
  cwd: string,
  runId: string,
  workspaceId: string,
  status: ExecutionWorkspaceStatus,
): Promise<ExecutionWorkspace> {
  const all = await readExecutionWorkspaces(cwd, runId);
  const existing = all.find((w) => w.id === workspaceId);
  if (!existing) {
    throw new Error(`Workspace ${workspaceId} not found in run ${runId}`);
  }
  const updated: ExecutionWorkspace = {
    ...existing,
    status,
    updated_at: new Date().toISOString(),
  };
  await appendExecutionWorkspace(cwd, runId, updated);
  return updated;
}

// ── Task-scoped storage (Plan §4 — Task 11) ──────────────────────────
//
// Per-task review/repair state lives one level below the run dir at
// `<runDir>/tasks/<task_id>/`. The split keeps run-wide concerns
// (continuation, source index, workspaces) separate from per-task
// review state, so a long-running task does not bloat run-level files.
//
// Append-only discipline matches the rest of the run ledger:
//   • JSONL files (findings, attempts, decisions, replies, events) —
//     append only; readers dedup by id with last-write-wins on a
//     well-defined timestamp axis.
//   • Markdown files (TASK_LEDGER.md, REPAIR_GUIDANCE.md) — replaced
//     atomically via .tmp + rename.
//
// Every reader tolerates a missing directory / file and returns [] or
// null. The §6 recovery protocol depends on this — an agent reading
// the active task pre-populates against potentially-missing artifacts.

export interface TaskLayout {
  taskDir: string;
  taskLedgerMd: string;
  reviewFindings: string;
  repairAttempts: string;
  repairDecisions: string;
  draftReplies: string;
  repairGuidance: string;
  reviewEvents: string;
}

export function resolveTaskLayout(
  cwd: string,
  runId: string,
  taskId: string,
): TaskLayout {
  const runLayout = resolveRunLayout(cwd, runId);
  const taskDir = join(runLayout.runDir, "tasks", taskId);
  return {
    taskDir,
    taskLedgerMd: join(taskDir, "TASK_LEDGER.md"),
    reviewFindings: join(taskDir, "REVIEW_FINDINGS.jsonl"),
    repairAttempts: join(taskDir, "REPAIR_ATTEMPTS.jsonl"),
    repairDecisions: join(taskDir, "REPAIR_DECISIONS.jsonl"),
    draftReplies: join(taskDir, "DRAFT_REPLIES.jsonl"),
    repairGuidance: join(taskDir, "REPAIR_GUIDANCE.md"),
    reviewEvents: join(taskDir, "REVIEW_EVENTS.jsonl"),
  };
}

async function ensureTaskDir(layout: TaskLayout): Promise<void> {
  await mkdir(layout.taskDir, { recursive: true });
}

/**
 * Read a JSONL file as an array of parsed lines. Tolerates missing
 * files (→ []) and malformed lines (silently skipped, matching the
 * existing run-level reader behavior).
 */
async function readJsonlLines<T>(
  path: string,
  parse: (raw: unknown) => T | null,
): Promise<T[]> {
  if (!existsSync(path)) return [];
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const parsed = parse(obj);
    if (parsed) out.push(parsed);
  }
  return out;
}

// ── ReviewFinding ────────────────────────────────────────────────────

export async function appendReviewFinding(
  cwd: string,
  runId: string,
  taskId: string,
  finding: ReviewFinding,
): Promise<void> {
  const parsed = ReviewFindingSchema.parse(finding);
  const layout = resolveTaskLayout(cwd, runId, taskId);
  await ensureTaskDir(layout);
  await appendFile(layout.reviewFindings, `${JSON.stringify(parsed)}\n`, "utf8");
}

/**
 * Read review findings, deduplicated last-write-wins per `id` on
 * `updated_at`. Sorted by `created_at` ascending.
 */
export async function readReviewFindings(
  cwd: string,
  runId: string,
  taskId: string,
): Promise<ReviewFinding[]> {
  const layout = resolveTaskLayout(cwd, runId, taskId);
  const all = await readJsonlLines(layout.reviewFindings, (obj) => {
    const r = ReviewFindingSchema.safeParse(obj);
    return r.success ? r.data : null;
  });
  const byId = new Map<string, ReviewFinding>();
  for (const f of all) {
    const existing = byId.get(f.id);
    if (!existing || f.updated_at >= existing.updated_at) byId.set(f.id, f);
  }
  return Array.from(byId.values()).sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
}

// ── RepairAttempt ────────────────────────────────────────────────────

export async function appendRepairAttempt(
  cwd: string,
  runId: string,
  taskId: string,
  attempt: RepairAttempt,
): Promise<void> {
  const parsed = RepairAttemptSchema.parse(attempt);
  const layout = resolveTaskLayout(cwd, runId, taskId);
  await ensureTaskDir(layout);
  await appendFile(layout.repairAttempts, `${JSON.stringify(parsed)}\n`, "utf8");
}

/**
 * Read repair attempts, deduplicated last-write-wins per `id` on
 * `completed_at ?? created_at`. Sorted by `attempt_number` ascending
 * — the durable sequence per finding. Tied attempt numbers preserve
 * insertion order (rare; only happens with concurrent writers).
 */
export async function readRepairAttempts(
  cwd: string,
  runId: string,
  taskId: string,
): Promise<RepairAttempt[]> {
  const layout = resolveTaskLayout(cwd, runId, taskId);
  const all = await readJsonlLines(layout.repairAttempts, (obj) => {
    const r = RepairAttemptSchema.safeParse(obj);
    return r.success ? r.data : null;
  });
  const byId = new Map<string, RepairAttempt>();
  for (const a of all) {
    const existing = byId.get(a.id);
    const ts = a.completed_at ?? a.created_at;
    const existingTs = existing
      ? existing.completed_at ?? existing.created_at
      : "";
    if (!existing || ts >= existingTs) byId.set(a.id, a);
  }
  return Array.from(byId.values()).sort(
    (a, b) => a.attempt_number - b.attempt_number,
  );
}

/**
 * Return the highest-attempt-number `RepairAttempt` for a given finding,
 * or null if none. Used by the policy engine (Task 12) to compare a
 * proposed next attempt against the most recent one.
 */
export async function readLatestRepairAttempt(
  cwd: string,
  runId: string,
  taskId: string,
  findingId: string,
): Promise<RepairAttempt | null> {
  const all = await readRepairAttempts(cwd, runId, taskId);
  const forFinding = all.filter((a) => a.finding_id === findingId);
  if (forFinding.length === 0) return null;
  // Already sorted by attempt_number asc; latest is the last entry.
  return forFinding[forFinding.length - 1] ?? null;
}

// ── RepairPolicyDecision ─────────────────────────────────────────────

export async function appendRepairDecision(
  cwd: string,
  runId: string,
  taskId: string,
  decision: RepairPolicyDecision,
): Promise<void> {
  const parsed = RepairPolicyDecisionSchema.parse(decision);
  const layout = resolveTaskLayout(cwd, runId, taskId);
  await ensureTaskDir(layout);
  await appendFile(
    layout.repairDecisions,
    `${JSON.stringify(parsed)}\n`,
    "utf8",
  );
}

/**
 * Read all repair decisions in insertion order (no dedup — every
 * decision is its own event with its own `id`). The "active" decision
 * for a finding is whichever was appended most recently.
 */
async function readRepairDecisions(
  cwd: string,
  runId: string,
  taskId: string,
): Promise<RepairPolicyDecision[]> {
  const layout = resolveTaskLayout(cwd, runId, taskId);
  return readJsonlLines(layout.repairDecisions, (obj) => {
    const r = RepairPolicyDecisionSchema.safeParse(obj);
    return r.success ? r.data : null;
  });
}

/**
 * Return the most recent `RepairPolicyDecision` for a finding (by
 * `created_at`), or null if none. The latest decision is the active
 * one — earlier decisions are kept for audit but superseded.
 */
export async function readActiveRepairDecision(
  cwd: string,
  runId: string,
  taskId: string,
  findingId: string,
): Promise<RepairPolicyDecision | null> {
  const all = await readRepairDecisions(cwd, runId, taskId);
  const forFinding = all.filter((d) => d.finding_id === findingId);
  if (forFinding.length === 0) return null;
  forFinding.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return forFinding[forFinding.length - 1] ?? null;
}

// ── DraftReply ───────────────────────────────────────────────────────

export async function appendDraftReply(
  cwd: string,
  runId: string,
  taskId: string,
  reply: DraftReply,
): Promise<void> {
  const parsed = DraftReplySchema.parse(reply);
  const layout = resolveTaskLayout(cwd, runId, taskId);
  await ensureTaskDir(layout);
  await appendFile(layout.draftReplies, `${JSON.stringify(parsed)}\n`, "utf8");
}

/**
 * Read draft replies, deduplicated last-write-wins per `id` on
 * `approved_at ?? created_at`. Sorted by `created_at` ascending.
 */
export async function readDraftReplies(
  cwd: string,
  runId: string,
  taskId: string,
): Promise<DraftReply[]> {
  const layout = resolveTaskLayout(cwd, runId, taskId);
  const all = await readJsonlLines(layout.draftReplies, (obj) => {
    const r = DraftReplySchema.safeParse(obj);
    return r.success ? r.data : null;
  });
  const byId = new Map<string, DraftReply>();
  for (const r of all) {
    const existing = byId.get(r.id);
    const ts = r.approved_at ?? r.created_at;
    const existingTs = existing
      ? existing.approved_at ?? existing.created_at
      : "";
    if (!existing || ts >= existingTs) byId.set(r.id, r);
  }
  return Array.from(byId.values()).sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
}

// ── REPAIR_GUIDANCE.md (atomic replace) ──────────────────────────────

/**
 * Write `REPAIR_GUIDANCE.md` atomically (write to .tmp then rename).
 * The caller is responsible for honoring the §3.8 word budget — this
 * helper is a dumb writer. The Task 13 guidance generator (deferred)
 * is what enforces budget caps.
 */
export async function writeRepairGuidance(
  cwd: string,
  runId: string,
  taskId: string,
  markdown: string,
): Promise<void> {
  const layout = resolveTaskLayout(cwd, runId, taskId);
  await ensureTaskDir(layout);
  const tmp = `${layout.repairGuidance}.tmp`;
  await writeFile(tmp, markdown, "utf8");
  await rename(tmp, layout.repairGuidance);
}

export async function readRepairGuidance(
  cwd: string,
  runId: string,
  taskId: string,
): Promise<string | null> {
  const layout = resolveTaskLayout(cwd, runId, taskId);
  if (!existsSync(layout.repairGuidance)) return null;
  try {
    return await readFile(layout.repairGuidance, "utf8");
  } catch {
    return null;
  }
}

// ── §2.13 ReviewLoopEvent stream (tagged-union JSONL) ────────────────
//
// Stored as a single `REVIEW_EVENTS.jsonl` per task. Each line is a
// `ReviewLoopEvent` envelope (`{ kind, event }`). No dedup — every
// event is its own record, and `id` lives inside `event`.
//
// Choosing the tagged-union approach (rather than 5 per-event files)
// because (a) the plan's §2.13 explicitly allows either, (b) a single
// stream preserves chronological ordering across kinds, and (c)
// projecting the stream into per-kind queries is a few lines of
// filter — see readReviewEvents below.

export async function appendReviewEvent(
  cwd: string,
  runId: string,
  taskId: string,
  event: ReviewLoopEvent,
): Promise<void> {
  const parsed = ReviewLoopEventSchema.parse(event);
  const layout = resolveTaskLayout(cwd, runId, taskId);
  await ensureTaskDir(layout);
  await appendFile(layout.reviewEvents, `${JSON.stringify(parsed)}\n`, "utf8");
}

/**
 * Read all review-loop events in append order. Tolerates missing
 * files and malformed lines. Optionally filter by `kind` to project a
 * single event type (e.g. only `user_approval` events).
 */
export async function readReviewEvents(
  cwd: string,
  runId: string,
  taskId: string,
  filter?: { kind?: ReviewLoopEvent["kind"] },
): Promise<ReviewLoopEvent[]> {
  const layout = resolveTaskLayout(cwd, runId, taskId);
  const all = await readJsonlLines(layout.reviewEvents, (obj) => {
    const r = ReviewLoopEventSchema.safeParse(obj);
    return r.success ? r.data : null;
  });
  if (filter?.kind) {
    return all.filter((e) => e.kind === filter.kind);
  }
  return all;
}

// Re-exports of the §2.13 event types for callers that already have
// `import { ... } from "./run_ledger.js"` — they don't need to reach
// into ./schema.js for these.
export type {
  BatchReport,
  DraftReply,
  RepairAttempt,
  RepairPolicyDecision,
  ReplySent,
  Result,
  ReviewFinding,
  ReviewLoopEvent,
  ReviewPass,
  UserApproval,
};
