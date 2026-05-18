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
