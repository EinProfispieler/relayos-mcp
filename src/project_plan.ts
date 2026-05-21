import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "ulid";
import {
  ProjectPlan,
  ProjectPlanTask,
  type HandoffInput,
  type ProjectPlan as ProjectPlanT,
  type ProjectPlanTask as ProjectPlanTaskT,
} from "./schema.js";
import type { OverseerLayout } from "./overseer.js";
import { stdoutLogPath, stderrLogPath, type StorageLayout } from "./storage.js";

const BLOCK_START = "PROJECT_PLAN";
const BLOCK_END = "END_PROJECT_PLAN";

interface ParsedPlan {
  goal: string;
  questions: string[];
  reporting: string;
  tasks: Array<Record<string, unknown>>;
}

/** Parse a `[t1, t2]` / `[]` style inline list. */
function parseInlineList(value: string): string[] {
  const inner = value.trim().replace(/^\[/, "").replace(/\]$/, "").trim();
  if (inner.length === 0) return [];
  return inner
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Extract and parse a `<PROJECT_PLAN>` block from agent output.
 * Tolerant: returns null if the block is absent or yields no valid task.
 */
export function parseProjectPlanBlock(text: string): ParsedPlan | null {
  const startIdx = text.indexOf(BLOCK_START);
  if (startIdx < 0) return null;
  const endIdx = text.indexOf(BLOCK_END, startIdx);
  if (endIdx < 0) return null;

  const body = text.slice(startIdx + BLOCK_START.length, endIdx);
  const lines = body.split("\n");

  let goal = "";
  let reporting = "";
  const questions: string[] = [];
  const tasks: Array<Record<string, unknown>> = [];
  let section: "none" | "questions" | "tasks" = "none";
  let current: Record<string, unknown> | null = null;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (line.trim().length === 0) continue;
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    // Top-level keys (no indentation).
    if (indent === 0) {
      const colon = trimmed.indexOf(":");
      const key = colon > 0 ? trimmed.slice(0, colon).trim().toLowerCase() : trimmed.toLowerCase();
      const value = colon > 0 ? trimmed.slice(colon + 1).trim() : "";
      if (key === "goal") {
        goal = value;
        section = "none";
        continue;
      }
      if (key === "reporting") {
        reporting = value;
        section = "none";
        continue;
      }
      if (key === "questions") {
        section = "questions";
        continue;
      }
      if (key === "tasks") {
        section = "tasks";
        current = null;
        continue;
      }
      section = "none";
      continue;
    }

    if (section === "questions" && trimmed.startsWith("-")) {
      const q = trimmed.replace(/^-\s*/, "").trim();
      if (q.length > 0) questions.push(q);
      continue;
    }

    if (section === "tasks") {
      // A list item beginning with "- id:" starts a new task.
      const itemMatch = trimmed.match(/^-\s*(.*)$/);
      if (itemMatch) {
        current = {};
        tasks.push(current);
        const rest = itemMatch[1]!.trim();
        if (rest.length > 0) {
          const colon = rest.indexOf(":");
          if (colon > 0) {
            current[rest.slice(0, colon).trim().toLowerCase()] = rest.slice(colon + 1).trim();
          }
        }
        continue;
      }
      if (current) {
        const colon = trimmed.indexOf(":");
        if (colon > 0) {
          const key = trimmed.slice(0, colon).trim().toLowerCase();
          const value = trimmed.slice(colon + 1).trim();
          current[key] = key === "depends_on" ? parseInlineList(value) : value;
        }
      }
    }
  }

  if (goal.length === 0) return null;

  const validTasks: Array<Record<string, unknown>> = [];
  for (const t of tasks) {
    const candidate = {
      id: t.id,
      title: t.title,
      target: t.target,
      model: t.model,
      effort: t.effort,
      mode: t.mode,
      description: t.description,
      depends_on: Array.isArray(t.depends_on) ? t.depends_on : [],
    };
    const parsed = ProjectPlanTask.safeParse(candidate);
    if (parsed.success) validTasks.push(candidate);
  }
  if (validTasks.length === 0) return null;

  return { goal, questions, reporting, tasks: validTasks };
}

/** Build a persisted ProjectPlan from a parsed block. */
export function buildProjectPlan(
  parsed: ParsedPlan,
  sourceHandoffId?: string,
): ProjectPlanT {
  return ProjectPlan.parse({
    plan_id: `plan_${ulid()}`,
    created_at: new Date().toISOString(),
    goal: parsed.goal,
    questions: parsed.questions,
    answers: [],
    tasks: parsed.tasks,
    reporting: parsed.reporting,
    source_handoff_id: sourceHandoffId,
    status: "awaiting_answers",
  });
}

function planPath(layout: OverseerLayout, planId: string): string {
  return join(layout.plansDir, `${planId}.json`);
}

export function persistProjectPlan(layout: OverseerLayout, plan: ProjectPlanT): string {
  mkdirSync(layout.plansDir, { recursive: true });
  const path = planPath(layout, plan.plan_id);
  writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return path;
}

export function loadProjectPlan(layout: OverseerLayout, planId: string): ProjectPlanT | null {
  const path = planPath(layout, planId);
  if (!existsSync(path)) return null;
  try {
    return ProjectPlan.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}

/** Append an answer to a persisted plan's answers[]. Returns the updated plan or null on failure. */
export function appendAnswerToplan(
  layout: OverseerLayout,
  planId: string,
  answer: string,
): ProjectPlanT | null {
  const plan = loadProjectPlan(layout, planId);
  if (!plan) return null;
  const updated = { ...plan, answers: [...plan.answers, answer] };
  persistProjectPlan(layout, updated);
  return updated;
}

/** Update a single task's status (and optionally handoff_id) in a persisted plan. */
export function updatePlanTaskStatus(
  layout: OverseerLayout,
  planId: string,
  taskId: string,
  status: ProjectPlanTaskT["status"],
  handoffId?: string,
): ProjectPlanT | null {
  const plan = loadProjectPlan(layout, planId);
  if (!plan) return null;
  const tasks = plan.tasks.map((t) =>
    t.id === taskId
      ? { ...t, status, ...(handoffId ? { handoff_id: handoffId } : {}) }
      : t,
  );
  const updated = { ...plan, tasks };
  persistProjectPlan(layout, updated);
  return updated;
}

/** Update retry_count on a task in a persisted plan. */
export function updatePlanTaskRetryCount(
  layout: OverseerLayout,
  planId: string,
  taskId: string,
  retryCount: number,
): ProjectPlanT | null {
  const plan = loadProjectPlan(layout, planId);
  if (!plan) return null;
  const tasks = plan.tasks.map((t) =>
    t.id === taskId ? { ...t, retry_count: retryCount } : t,
  );
  const updated = { ...plan, tasks };
  persistProjectPlan(layout, updated);
  return updated;
}

/**
 * Read stdout + stderr tails from a handoff's log files.
 * Caps combined output to ~2000 chars.
 */
export function getTaskErrorContext(layout: StorageLayout, handoffId: string): string {
  const CAP = 2000;
  const parts: string[] = [];

  const outPath = stdoutLogPath(layout, handoffId);
  if (existsSync(outPath)) {
    const content = readFileSync(outPath, "utf8");
    const tail = content.length > CAP ? `…(truncated)\n${content.slice(-CAP)}` : content;
    if (tail.trim().length > 0) parts.push(`--- stdout ---\n${tail}`);
  }

  const errPath = stderrLogPath(layout, handoffId);
  if (existsSync(errPath)) {
    const content = readFileSync(errPath, "utf8");
    const tail = content.length > CAP ? `…(truncated)\n${content.slice(-CAP)}` : content;
    if (tail.trim().length > 0) parts.push(`--- stderr ---\n${tail}`);
  }

  const combined = parts.join("\n");
  return combined.length > CAP * 2 ? combined.slice(-(CAP * 2)) : combined;
}

/**
 * Like buildTaskHandoffInput but prepends the prior attempt's error context.
 */
export function buildFixHandoffInput(
  task: ProjectPlanTaskT,
  plan: ProjectPlanT,
  cwd: string,
  originalHandoffId: string,
  errorContext: string,
  attemptNum: number,
): HandoffInput {
  const base = buildTaskHandoffInput(task, plan, cwd);

  const fixPrefix = [
    `[Fix attempt ${attemptNum} for task ${task.id}]`,
    `Previous handoff: ${originalHandoffId}`,
    ``,
    `Error context from previous run:`,
    errorContext || "(no output captured)",
    ``,
    `Please diagnose the failure above and fix it.`,
    ``,
  ].join("\n");

  return {
    ...base,
    task_title: `[fix-${attemptNum}] ${base.task_title}`,
    task_description: fixPrefix + base.task_description,
  };
}

/**
 * Build a HandoffInput from a ProjectPlanTask + plan context.
 * The task already carries all routing data — no re-routing is needed.
 */
export function buildTaskHandoffInput(
  task: ProjectPlanTaskT,
  plan: ProjectPlanT,
  cwd: string,
): HandoffInput {
  const contextLines = [
    `Project plan goal: ${plan.goal}`,
  ];
  if (plan.answers.length > 0) {
    contextLines.push("", "User's answers to planning questions:");
    plan.answers.forEach((a, i) => contextLines.push(`  Q${i + 1}: ${a}`));
  }
  const contextBlock = contextLines.join("\n");

  const description = [
    contextBlock,
    "",
    `Task: ${task.title}`,
    task.description,
  ].join("\n");

  return {
    source_agent: "claude",
    target_agent: task.target,
    model: task.model,
    effort: task.effort,
    execution_mode: task.mode,
    task_title: `[${plan.plan_id}/${task.id}] ${task.title}`,
    task_description: description,
    allowed_files: [],
    forbidden_files: [".env*", "secrets/**", "**/node_modules/**"],
    constraints: [],
    expected_output: [`Complete: ${task.title}`, "write_handoff_result with status and summary"],
    working_dir: cwd,
    auto_spawn: false,
  };
}

// ── Plan Report ──────────────────────────────────────────────────────────────

export interface PlanReportData {
  plan_id: string;
  goal: string;
  generated_at: string;
  summary: {
    total: number;
    completed: number;
    failed: number;
    blocked: number;
    pending: number;
  };
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    handoff_id?: string;
    result_summary?: string;
    test_result?: string;
    needs_review?: boolean;
    blockers?: string[];
  }>;
  markdown: string;
}

interface HandoffResult {
  run_id: string;
  status: string;
  summary?: string;
  test_result?: string;
  needs_review?: boolean;
  blockers?: string[];
}

function readHandoffResults(layout: OverseerLayout): Map<string, HandoffResult> {
  const path = join(layout.dir, "handoff_results.jsonl");
  const map = new Map<string, HandoffResult>();
  if (!existsSync(path)) return map;
  try {
    const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0);
    for (const line of lines) {
      try {
        const r = JSON.parse(line) as HandoffResult;
        if (r.run_id) map.set(r.run_id, r);
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // ignore read errors
  }
  return map;
}

export function buildPlanReport(layout: OverseerLayout, plan: ProjectPlanT): PlanReportData {
  const results = readHandoffResults(layout);
  const generated_at = new Date().toISOString();

  const tasks: PlanReportData["tasks"] = plan.tasks.map((t) => {
    const result = t.handoff_id ? results.get(t.handoff_id) : undefined;
    return {
      id: t.id,
      title: t.title,
      status: t.status,
      handoff_id: t.handoff_id,
      result_summary: result?.summary,
      test_result: result?.test_result,
      needs_review: result?.needs_review,
      blockers: result?.blockers,
    };
  });

  const summary = {
    total: tasks.length,
    completed: tasks.filter((t) => t.status === "completed").length,
    failed: tasks.filter((t) => t.status === "failed").length,
    blocked: tasks.filter((t) => t.status === "blocked").length,
    pending: tasks.filter((t) => t.status === "pending" || t.status === "running").length,
  };

  // Build markdown
  const mdLines: string[] = [];
  mdLines.push(`# Plan Report: ${plan.plan_id}`);
  mdLines.push(``);
  mdLines.push(`**Goal:** ${plan.goal}`);
  mdLines.push(`**Generated:** ${generated_at}`);
  mdLines.push(``);
  mdLines.push(`## Summary`);
  mdLines.push(``);
  mdLines.push(`- Total: ${summary.total}`);
  mdLines.push(`- Completed: ${summary.completed}`);
  if (summary.failed > 0) mdLines.push(`- Failed: ${summary.failed}`);
  if (summary.blocked > 0) mdLines.push(`- Blocked: ${summary.blocked}`);
  if (summary.pending > 0) mdLines.push(`- Pending/Running: ${summary.pending}`);
  mdLines.push(``);
  mdLines.push(`## Tasks`);
  mdLines.push(``);
  mdLines.push(`| ID | Title | Status | Summary |`);
  mdLines.push(`|----|-------|--------|---------|`);
  for (const t of tasks) {
    const summary_col = t.result_summary ?? "";
    mdLines.push(`| ${t.id} | ${t.title} | ${t.status} | ${summary_col} |`);
  }

  if (plan.questions.length > 0) {
    mdLines.push(``);
    mdLines.push(`## Questions & Answers`);
    mdLines.push(``);
    plan.questions.forEach((q, i) => {
      mdLines.push(`**Q${i + 1}:** ${q}`);
      const a = plan.answers[i];
      if (a) mdLines.push(`**A${i + 1}:** ${a}`);
      mdLines.push(``);
    });
  }

  const markdown = mdLines.join("\n");

  return {
    plan_id: plan.plan_id,
    goal: plan.goal,
    generated_at,
    summary,
    tasks,
    markdown,
  };
}

export function persistPlanReport(layout: OverseerLayout, plan_id: string, report: PlanReportData): void {
  mkdirSync(layout.plansDir, { recursive: true });
  const path = join(layout.plansDir, `${plan_id}.report.md`);
  writeFileSync(path, report.markdown, "utf8");
}
