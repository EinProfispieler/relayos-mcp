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
  ExecutionWorkspace as ExecutionWorkspaceSchema,
  RunRecord as RunRecordSchema,
  SourceIndexEntry as SourceIndexEntrySchema,
  TaskLedgerEntry as TaskLedgerEntrySchema,
  type ContinuationPacket,
  type ExecutionWorkspace,
  type ExecutionWorkspaceStatus,
  type RunRecord,
  type SourceIndexEntry,
  type TaskLedgerEntry,
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
